using System.Collections.Concurrent;
using System.Diagnostics;
using Speculum.Api.Diagnostics.Abstractions;
using Speculum.Api.Diagnostics.Emitters;

namespace Speculum.Api.Diagnostics.Pipeline;

public sealed class SessionEventRing
{
    private readonly ConcurrentDictionary<string, LinkedList<DiagnosticsEvent>> _rings = new();
    private readonly int _capacityPerSession;

    public SessionEventRing(int capacityPerSession = 256)
    {
        _capacityPerSession = Math.Max(16, capacityPerSession);
    }

    public void Add(DiagnosticsEvent evt)
    {
        if (string.IsNullOrWhiteSpace(evt.ConnectionId))
            return;

        var list = _rings.GetOrAdd(evt.ConnectionId, _ => new LinkedList<DiagnosticsEvent>());
        lock (list)
        {
            list.AddLast(evt);
            while (list.Count > _capacityPerSession)
                list.RemoveFirst();
        }
    }

    public IReadOnlyList<DiagnosticsEvent> GetSince(string connectionId, DateTimeOffset? since, string? namePrefix)
    {
        if (!_rings.TryGetValue(connectionId, out var list))
            return [];

        lock (list)
        {
            return list
                .Where(e => since is null || e.Utc >= since)
                .Where(e => string.IsNullOrEmpty(namePrefix)
                            || e.Name.StartsWith(namePrefix, StringComparison.OrdinalIgnoreCase))
                .ToArray();
        }
    }

    public void Clear(string connectionId)
        => _rings.TryRemove(connectionId, out _);
}

public sealed class NullDiagnosticsSink : IDiagnosticsSink
{
    public ValueTask WriteAsync(DiagnosticsEvent diagnosticsEvent, CancellationToken ct = default)
        => ValueTask.CompletedTask;
}

/// <summary>Current circuit-breaker window counters (drops / slow sink writes in the last window).</summary>
public readonly record struct DiagnosticsBreakerPressure(long RecentDrops, long RecentSlowWrites);

public sealed class DiagnosticsEventBus : IDiagnosticsEventBus
{
    private readonly IDiagnosticsRuntime _runtime;
    private readonly IEnumerable<IDiagnosticsSink> _sinks;
    private readonly SessionEventRing _ring;
    private readonly Lazy<IDiagnosticsSelfEmitter> _self;
    private readonly ILogger<DiagnosticsEventBus> _logger;
    private readonly TimeProvider _timeProvider;
    private long _recentDrops;
    private long _recentSlowWrites;
    private DateTimeOffset _windowStart;
    private static readonly TimeSpan SlowWriteThreshold = TimeSpan.FromMilliseconds(250);

    public DiagnosticsEventBus(
        IDiagnosticsRuntime runtime,
        IEnumerable<IDiagnosticsSink> sinks,
        SessionEventRing ring,
        Lazy<IDiagnosticsSelfEmitter> self,
        ILogger<DiagnosticsEventBus> logger,
        TimeProvider? timeProvider = null)
    {
        _runtime = runtime;
        _sinks = sinks;
        _ring = ring;
        _self = self;
        _logger = logger;
        _timeProvider = timeProvider ?? TimeProvider.System;
        _windowStart = _timeProvider.GetUtcNow();
    }

    /// <summary>Breaker-window pressure for Telemetry (pipeline section, behind IncludeBreakerPressure).</summary>
    public DiagnosticsBreakerPressure GetBreakerPressure()
        => new(Volatile.Read(ref _recentDrops), Volatile.Read(ref _recentSlowWrites));

    public void Publish(DiagnosticsEvent diagnosticsEvent, bool persist = true)
    {
        if (!_runtime.Enabled)
            return;

        // Transport is domain-agnostic: gating comes purely from the catalog descriptor
        // + settings. Every emitted event MUST be catalogued.
        if (!DiagnosticsEventCatalog.TryGet(diagnosticsEvent.Name, out var descriptor))
        {
            _logger.LogWarning(
                "Dropping uncatalogued diagnostics event {EventName}", diagnosticsEvent.Name);
            return;
        }

        if (descriptor.Domain != DiagnosticsDomain.DiagnosticsSelf
            && !_runtime.IsCapabilityEnabled(descriptor.Domain, descriptor.Capability))
            return;

        _ring.Add(diagnosticsEvent);
        if (!persist || !descriptor.Persist)
            return;

        foreach (var sink in _sinks)
        {
            if (sink is NullDiagnosticsSink)
                continue;

            var sw = Stopwatch.StartNew();
            try
            {
                sink.WriteAsync(diagnosticsEvent).AsTask().GetAwaiter().GetResult();
                sw.Stop();
                if (sw.Elapsed > SlowWriteThreshold)
                    NoteSlowWrite();
            }
            catch (Exception ex)
            {
                _runtime.ReportPublishDropped();
                NoteDrop();
                _logger.LogWarning(ex, "Diagnostics sink write failed for {EventName}", diagnosticsEvent.Name);
            }
        }
    }

    private void NoteDrop()
    {
        RollWindow();
        // Sustained sink failure / backpressure — not a single flaky write under Assertive load.
        if (Interlocked.Increment(ref _recentDrops) > 200)
            TripBreaker("drop_rate");
    }

    private void NoteSlowWrite()
    {
        RollWindow();
        // Sync SQLite under BrowserQuery Assertive is routinely >100ms on CI disks;
        // trip only on sustained latency, not a brief spike wave.
        if (Interlocked.Increment(ref _recentSlowWrites) > 40)
            TripBreaker("write_latency");
    }

    private void RollWindow()
    {
        var now = _timeProvider.GetUtcNow();
        if (now - _windowStart <= TimeSpan.FromSeconds(10))
            return;
        Interlocked.Exchange(ref _recentDrops, 0);
        Interlocked.Exchange(ref _recentSlowWrites, 0);
        _windowStart = now;
    }

    private void TripBreaker(string reason)
    {
        if (_runtime.IsDegraded)
            return;
        _runtime.SetDegraded(true);
        _self.Value.Degraded(reason);
    }
}
