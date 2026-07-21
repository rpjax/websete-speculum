using System.Threading.Channels;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Speculum.Api.Journal.Models;
using Speculum.Api.Journal.Services.Contracts;
using Speculum.Api.Journal.Storage;

namespace Speculum.Api.Journal.Services;

/// <summary>
/// Channel-backed Journal admission queue with wake-up and depth guards.
/// Depth is reserved with <see cref="Interlocked"/> before <c>TryWrite</c> so Count stays coherent under concurrency.
/// The channel stays open for the process lifetime.
/// </summary>
public sealed class JournalQueue : IJournalQueue
{
    private readonly Channel<JournalEntry> _channel;
    private readonly IOptionsMonitor<JournalDrainOptions> _options;
    private readonly JournalDrainMetrics _metrics;
    private readonly IJournalHealth _health;
    private int _depth;
    private int _hardDepthLatched;

    public JournalQueue(
        IOptionsMonitor<JournalDrainOptions> options,
        JournalDrainMetrics metrics,
        IJournalHealth health,
        ILogger<JournalQueue> logger)
    {
        _ = logger ?? throw new ArgumentNullException(nameof(logger));
        _options = options ?? throw new ArgumentNullException(nameof(options));
        _metrics = metrics ?? throw new ArgumentNullException(nameof(metrics));
        _health = health ?? throw new ArgumentNullException(nameof(health));

        _channel = Channel.CreateUnbounded<JournalEntry>(new UnboundedChannelOptions
        {
            SingleReader = true,
            SingleWriter = false,
            AllowSynchronousContinuations = false,
        });
    }

    public int Count
    {
        get
        {
            var count = Math.Max(0, Volatile.Read(ref _depth));
            _metrics.SampleQueueDepth(count);
            return count;
        }
    }

    public void Enqueue(JournalEntry entry)
    {
        ArgumentNullException.ThrowIfNull(entry);
        ArgumentException.ThrowIfNullOrWhiteSpace(entry.Type);
        ArgumentOutOfRangeException.ThrowIfLessThan(entry.SchemaVersion, 1);
        ArgumentNullException.ThrowIfNull(entry.IndexKeys);

        if (entry.Id == Guid.Empty)
            throw new ArgumentException("Journal entry Id must be stamped before enqueue.", nameof(entry));

        if (entry.PublishedAt == default)
            throw new ArgumentException("Journal entry PublishedAt must be stamped before enqueue.", nameof(entry));

        if (entry.Type.Length > JournalStoreLimits.MaxTypeLength)
        {
            throw new ArgumentException(
                $"Journal entry Type exceeds {JournalStoreLimits.MaxTypeLength} characters.",
                nameof(entry));
        }

        foreach (var key in entry.IndexKeys)
        {
            if (key.Type.Length > JournalStoreLimits.MaxIndexTypeLength
                || key.Value.Length > JournalStoreLimits.MaxIndexValueLength)
            {
                throw new ArgumentException(
                    $"Journal index key '{key.Type}' exceeds store length limits.",
                    nameof(entry));
            }
        }

        var opts = _options.CurrentValue;
        var depth = Math.Max(0, Volatile.Read(ref _depth));
        _metrics.SampleQueueDepth(depth);

        if (opts.MaxQueueDepth > 0 && depth >= opts.MaxQueueDepth)
        {
            RejectAtMaxDepth(entry, opts.MaxQueueDepth);
            return;
        }

        if (entry.PublishPolicy == PublishPolicy.BestEffort
            && ShouldShedBestEffort(depth, opts))
        {
            _metrics.RecordDroppedOnEnqueue();
            return;
        }

        var reserved = Interlocked.Increment(ref _depth);
        if (opts.MaxQueueDepth > 0 && reserved > opts.MaxQueueDepth)
        {
            Interlocked.Decrement(ref _depth);
            RejectAtMaxDepth(entry, opts.MaxQueueDepth);
            return;
        }

        if (!_channel.Writer.TryWrite(entry))
        {
            Interlocked.Decrement(ref _depth);
            if (entry.PublishPolicy == PublishPolicy.Guaranteed)
            {
                _metrics.RecordGuaranteedAdmissionFailure();
                _health.MarkDegraded("Journal queue rejected Guaranteed enqueue (TryWrite failed).");
            }
            else
            {
                _metrics.RecordDroppedOnEnqueue();
            }

            return;
        }

        _metrics.RecordEnqueue();
        _metrics.SampleQueueDepth(Math.Max(0, reserved));
        ObserveHardDepth(Math.Max(0, reserved), opts.HardQueueDepth);
    }

    public async ValueTask<IReadOnlyList<JournalEntry>> TakeBatchAsync(
        int maxCount,
        CancellationToken cancellationToken = default)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(maxCount, 1);

        while (await _channel.Reader.WaitToReadAsync(cancellationToken).ConfigureAwait(false))
        {
            var batch = DrainAvailable(maxCount);
            if (batch.Count > 0)
                return batch;
        }

        return Array.Empty<JournalEntry>();
    }

    private void RejectAtMaxDepth(JournalEntry entry, int max)
    {
        if (entry.PublishPolicy == PublishPolicy.Guaranteed)
        {
            _metrics.RecordGuaranteedAdmissionFailure();
            _health.MarkDegraded(
                $"Journal queue at MaxQueueDepth ({max}); Guaranteed admission rejected.");
        }
        else
        {
            _metrics.RecordDroppedOnEnqueue();
        }
    }

    private static bool ShouldShedBestEffort(int depth, JournalDrainOptions opts)
    {
        var soft = opts.SoftQueueDepth;
        if (soft > 0 && depth >= soft)
            return true;

        var hard = opts.HardQueueDepth;
        return hard > 0 && depth >= hard;
    }

    private void ObserveHardDepth(int depth, int hard)
    {
        if (hard <= 0)
            return;

        if (depth >= hard)
        {
            if (Interlocked.CompareExchange(ref _hardDepthLatched, 1, 0) == 0)
            {
                _metrics.RecordHardDepthPressure();
                _health.MarkQueuePressure(
                    $"Journal queue depth reached HardQueueDepth ({hard}).");
            }

            return;
        }

        var clearBelow = Math.Max(0, _options.CurrentValue.SoftQueueDepth);
        if (clearBelow <= 0)
            clearBelow = Math.Max(0, hard / 2);

        if (depth < clearBelow
            && Interlocked.CompareExchange(ref _hardDepthLatched, 0, 1) == 1)
        {
            _health.ClearQueuePressure();
        }
    }

    private IReadOnlyList<JournalEntry> DrainAvailable(int maxCount)
    {
        var list = new List<JournalEntry>(Math.Min(maxCount, 16));
        while (list.Count < maxCount && _channel.Reader.TryRead(out var entry))
        {
            var depth = Interlocked.Decrement(ref _depth);
            if (depth < 0)
            {
                Interlocked.Exchange(ref _depth, 0);
                depth = 0;
            }

            list.Add(entry);
            ObserveHardDepth(depth, _options.CurrentValue.HardQueueDepth);
        }

        _metrics.SampleQueueDepth(Math.Max(0, Volatile.Read(ref _depth)));
        return list.Count == 0 ? Array.Empty<JournalEntry>() : list;
    }
}
