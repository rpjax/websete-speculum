using System.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Speculum.Api.Journal.Models;
using Speculum.Api.Journal.Services.Contracts;

namespace Speculum.Api.Journal.Services;

/// <summary>
/// Hosted drain: blocking TakeBatch → persist with in-place retries.
/// Crash → backoff/retry; too many crashes in a window → stop host.
/// Shutdown: cancel wait → finish in-flight persist → TakeBatch remainder while Count &gt; 0.
/// </summary>
public sealed class JournalWorker : IHostedService, IDisposable
{
    private readonly IJournalQueue _queue;
    private readonly IJournalDrainPolicy _policy;
    private readonly IJournalHealth _health;
    private readonly JournalDrainMetrics _metrics;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IOptionsMonitor<JournalDrainOptions> _options;
    private readonly IHostApplicationLifetime _lifetime;
    private readonly ILogger<JournalWorker> _logger;
    private readonly List<DateTimeOffset> _crashTimestamps = new();
    private readonly CancellationTokenSource _runCts = new();

    private Task? _executeTask;
    private int _disposed;

    public JournalWorker(
        IJournalQueue queue,
        IJournalDrainPolicy policy,
        IJournalHealth health,
        JournalDrainMetrics metrics,
        IServiceScopeFactory scopeFactory,
        IOptionsMonitor<JournalDrainOptions> options,
        IHostApplicationLifetime lifetime,
        ILogger<JournalWorker> logger)
    {
        _queue = queue ?? throw new ArgumentNullException(nameof(queue));
        _policy = policy ?? throw new ArgumentNullException(nameof(policy));
        _health = health ?? throw new ArgumentNullException(nameof(health));
        _metrics = metrics ?? throw new ArgumentNullException(nameof(metrics));
        _scopeFactory = scopeFactory ?? throw new ArgumentNullException(nameof(scopeFactory));
        _options = options ?? throw new ArgumentNullException(nameof(options));
        _lifetime = lifetime ?? throw new ArgumentNullException(nameof(lifetime));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    private JournalDrainOptions Options => _options.CurrentValue;

    public Task? ExecuteTask => Volatile.Read(ref _executeTask);

    public Task StartAsync(CancellationToken cancellationToken)
    {
        if (Volatile.Read(ref _executeTask) is not null)
            throw new InvalidOperationException("Journal worker already started.");

        _health.SetDrainRunning(true);
        _logger.LogInformation("Journal worker started.");

        // Don't wrap in Task.Run — ExecuteAsync yields on first await.
        var task = ExecuteAsync(_runCts.Token);
        Volatile.Write(ref _executeTask, task);
        return Task.CompletedTask;
    }

    public async Task StopAsync(CancellationToken cancellationToken)
    {
        var executeTask = Volatile.Read(ref _executeTask);
        if (executeTask is null)
        {
            _health.SetDrainRunning(false);
            return;
        }

        try
        {
            _runCts.Cancel();
        }
        catch (ObjectDisposedException)
        {
            // already disposed
        }

        // Always finish the loop (in-flight ProcessBatch uses CancellationToken.None).
        try
        {
            await executeTask.ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            // expected from cancelled TakeBatch
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Journal worker faulted during shutdown.");
        }

        // Sole reader: drain remainder with TakeBatch while Count > 0 (bounded).
        using var drainCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        drainCts.CancelAfter(Options.ShutdownFlushTimeout);

        try
        {
            while (_queue.Count > 0 && !drainCts.IsCancellationRequested)
            {
                var batch = await _queue
                    .TakeBatchAsync(Math.Max(1, Options.MaxBatchSize), drainCts.Token)
                    .ConfigureAwait(false);
                if (batch.Count == 0)
                    break;

                await ProcessBatchAsync(batch, CancellationToken.None).ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException)
        {
            // drain budget exhausted
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Journal shutdown drain failed.");
        }

        var abandoned = _queue.Count;
        if (abandoned > 0)
        {
            _metrics.RecordShutdownAbandoned(abandoned);
            _logger.LogWarning(
                "Journal shutdown left ~{Depth} queued entries (timeout {Timeout}).",
                abandoned,
                Options.ShutdownFlushTimeout);
        }

        _health.SetDrainRunning(false);
        _logger.LogInformation("Journal worker stopped. QueueDepth={Depth}", _queue.Count);
    }

    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0)
            return;

        try
        {
            _runCts.Cancel();
        }
        catch (ObjectDisposedException)
        {
            // ignore
        }

        _runCts.Dispose();
    }

    private async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                _health.SetDrainRunning(true);
                await LoopAsync(stoppingToken).ConfigureAwait(false);
                break;
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                RecordCrash();
                _health.MarkDegraded(ex);
                _metrics.RecordLoopCrash();

                if (HasExceededCrashBudget())
                {
                    _logger.LogCritical(
                        ex,
                        "Journal worker exceeded {MaxCrashes} crashes within {Period}; stopping host.",
                        Options.MaxCrashesInPeriod,
                        Options.CrashPeriod);
                    _health.SetDrainRunning(false);
                    _lifetime.StopApplication();
                    return;
                }

                _health.SetDrainRunning(false);
                _logger.LogError(
                    ex,
                    "Journal worker loop crashed ({CrashCount} in {Period}). Restarting after backoff.",
                    CountCrashesInPeriod(),
                    Options.CrashPeriod);

                try
                {
                    await Task.Delay(Options.CrashRestartBackoff, stoppingToken).ConfigureAwait(false);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    break;
                }
            }
        }
    }

    private async Task LoopAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            var batch = await _queue
                .TakeBatchAsync(Math.Max(1, Options.MaxBatchSize), cancellationToken)
                .ConfigureAwait(false);
            if (batch.Count == 0)
                break;

            // Persist without the stop token so cancel-on-wait cannot drop a dequeued batch.
            await ProcessBatchAsync(batch, CancellationToken.None).ConfigureAwait(false);
        }
    }

    private async Task ProcessBatchAsync(
        IReadOnlyList<JournalEntry> batch,
        CancellationToken cancellationToken)
    {
        var options = Options;
        var decision = _policy.Decide(batch, _health.State, options);
        _metrics.RecordDroppedByPolicy(decision.Drop.Count);

        if (decision.Persist.Count == 0)
            return;

        var maxAttempts = Math.Max(1, options.MaxPersistAttempts);
        var hasGuaranteed = decision.Persist.Any(e => e.PublishPolicy == PublishPolicy.Guaranteed);

        for (var attempt = 1; attempt <= maxAttempts; attempt++)
        {
            cancellationToken.ThrowIfCancellationRequested();

            using var activity = JournalDrainMetrics.ActivitySource.StartActivity("Journal.PersistBatch");
            activity?.SetTag("journal.batch.size", decision.Persist.Count);
            activity?.SetTag("journal.batch.attempt", attempt);

            var sw = Stopwatch.StartNew();
            try
            {
                await using var scope = _scopeFactory.CreateAsyncScope();
                var repo = scope.ServiceProvider.GetRequiredService<IJournalRepository>();
                var inserted = await repo.SaveBatchAsync(decision.Persist, cancellationToken)
                    .ConfigureAwait(false);
                sw.Stop();
                activity?.SetTag("journal.batch.inserted", inserted);

                if (inserted > 0)
                {
                    _metrics.RecordPersist(inserted, sw.ElapsedMilliseconds);
                    _health.NoteSuccess();
                }
                else
                {
                    _metrics.RecordPersistBatch(sw.ElapsedMilliseconds);
                }

                return;
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception ex)
            {
                sw.Stop();
                activity?.SetStatus(ActivityStatusCode.Error, ex.Message);
                _health.MarkDegraded(ex);
                _metrics.RecordPersistFailure();
                _logger.LogError(
                    ex,
                    "Journal persist failed for batch of {Count} (attempt {Attempt}/{MaxAttempts}).",
                    decision.Persist.Count,
                    attempt,
                    maxAttempts);

                if (attempt >= maxAttempts)
                {
                    _metrics.RecordPersistAbandoned(decision.Persist.Count);
                    if (hasGuaranteed)
                    {
                        _health.MarkDegraded(
                            $"Journal dropped Guaranteed batch of {decision.Persist.Count} after {maxAttempts} persist failures.");
                    }

                    _logger.LogError(
                        "Journal dropping batch of {Count} after {MaxAttempts} failed persist attempt(s).",
                        decision.Persist.Count,
                        maxAttempts);
                    return;
                }

                await Task.Delay(options.RetryBackoff, cancellationToken).ConfigureAwait(false);
            }
        }
    }

    private void RecordCrash()
    {
        var now = DateTimeOffset.UtcNow;
        PruneCrashes(now);
        _crashTimestamps.Add(now);
    }

    private bool HasExceededCrashBudget()
    {
        var now = DateTimeOffset.UtcNow;
        PruneCrashes(now);
        return _crashTimestamps.Count >= Math.Max(1, Options.MaxCrashesInPeriod);
    }

    private int CountCrashesInPeriod()
    {
        PruneCrashes(DateTimeOffset.UtcNow);
        return _crashTimestamps.Count;
    }

    private void PruneCrashes(DateTimeOffset now)
    {
        var cutoff = now - Options.CrashPeriod;
        _crashTimestamps.RemoveAll(t => t < cutoff);
    }
}
