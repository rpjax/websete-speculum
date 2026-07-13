using System.Collections.Concurrent;
using Speculum.Api.Diagnostics.Abstractions;

namespace Speculum.Api.Diagnostics.Pipeline;

/// <summary>Enforces max concurrent probes per connection id.</summary>
public sealed class DiagnosticsProbeGate
{
    private readonly ConcurrentDictionary<string, int> _inFlight = new(StringComparer.Ordinal);
    private readonly IDiagnosticsRuntime _runtime;

    public DiagnosticsProbeGate(IDiagnosticsRuntime runtime)
    {
        _runtime = runtime;
    }

    public bool TryEnter(string connectionId, out IDisposable? lease)
    {
        lease = null;
        var max = Math.Max(1, _runtime.GetSnapshot().Options.Probe.MaxConcurrentProbesPerSession);
        while (true)
        {
            var current = _inFlight.GetOrAdd(connectionId, 0);
            if (current >= max)
                return false;
            if (_inFlight.TryUpdate(connectionId, current + 1, current))
            {
                lease = new Lease(this, connectionId);
                return true;
            }
        }
    }

    private void Exit(string connectionId)
    {
        _inFlight.AddOrUpdate(connectionId, 0, (_, current) => Math.Max(0, current - 1));
        if (_inFlight.TryGetValue(connectionId, out var remaining) && remaining == 0)
            _inFlight.TryRemove(connectionId, out _);
    }

    private sealed class Lease(DiagnosticsProbeGate gate, string connectionId) : IDisposable
    {
        private int _disposed;
        public void Dispose()
        {
            if (Interlocked.Exchange(ref _disposed, 1) == 0)
                gate.Exit(connectionId);
        }
    }
}
