using System.Collections.Concurrent;
using System.Diagnostics;
using Speculum.Api.Diagnostics.Abstractions;

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

public sealed class DiagnosticsEventBus : IDiagnosticsEventBus
{
    private readonly IDiagnosticsRuntime _runtime;
    private readonly IEnumerable<IDiagnosticsSink> _sinks;
    private readonly SessionEventRing _ring;
    private readonly ILogger<DiagnosticsEventBus> _logger;
    private long _recentDrops;
    private long _recentSlowWrites;
    private DateTimeOffset _windowStart = DateTimeOffset.UtcNow;
    private static readonly TimeSpan SlowWriteThreshold = TimeSpan.FromMilliseconds(100);

    public DiagnosticsEventBus(
        IDiagnosticsRuntime runtime,
        IEnumerable<IDiagnosticsSink> sinks,
        SessionEventRing ring,
        ILogger<DiagnosticsEventBus> logger)
    {
        _runtime = runtime;
        _sinks = sinks;
        _ring = ring;
        _logger = logger;
    }

    public void Publish(DiagnosticsEvent diagnosticsEvent, bool persist = true)
    {
        if (!_runtime.Enabled)
            return;

        var minLevel = diagnosticsEvent.Domain == DiagnosticsDomain.DiagnosticsSelf
            ? DiagnosticsLevel.Metrics
            : DiagnosticsLevel.Events;

        // Catalog Act→Assert + ops evidence must survive Metrics-only domains / Degraded cap.
        if (diagnosticsEvent.Name == "Motor.StatusMirrored"
            || DiagnosticsEventCatalog.All.Contains(diagnosticsEvent.Name)
            || diagnosticsEvent.Name.StartsWith("Sidecar.DiagProbe", StringComparison.Ordinal)
            || diagnosticsEvent.Name.StartsWith("Motor.StateExport", StringComparison.Ordinal)
            || diagnosticsEvent.Name.StartsWith("Motor.Drain", StringComparison.Ordinal))
        {
            minLevel = DiagnosticsLevel.Metrics;
        }

        if (!_runtime.IsEnabled(diagnosticsEvent.Domain, minLevel)
            && diagnosticsEvent.Domain != DiagnosticsDomain.DiagnosticsSelf)
            return;

        // Act→Assert catalog events are never randomly dropped.
        // Sampling for noisy mirrors is handled at the StatusMirror emission site
        // via StatusMirrorRatio / ExpensiveEventRatio — not here.

        _ring.Add(diagnosticsEvent);
        if (!persist)
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
        if (Interlocked.Increment(ref _recentDrops) > 50)
            TripBreaker("drop_rate");
    }

    private void NoteSlowWrite()
    {
        RollWindow();
        if (Interlocked.Increment(ref _recentSlowWrites) > 10)
            TripBreaker("write_latency");
    }

    private void RollWindow()
    {
        var now = DateTimeOffset.UtcNow;
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
        Publish(new DiagnosticsEvent
        {
            Domain = DiagnosticsDomain.DiagnosticsSelf,
            Name = "Diagnostics.Degraded",
            Severity = DiagnosticsSeverity.Warning,
            Payload = new { reason },
        });
    }
}
