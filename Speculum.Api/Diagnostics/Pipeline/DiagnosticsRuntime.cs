using Speculum.Api.Diagnostics.Abstractions;
using Speculum.Api.Diagnostics.Configuration;

namespace Speculum.Api.Diagnostics.Pipeline;

public sealed class DiagnosticsRuntime : IDiagnosticsRuntime
{
    private readonly object _gate = new();
    private DiagnosticsOptions _options = DiagnosticsSeedProfiles.Production();
    private DateTimeOffset? _elevateExpiresUtc;
    private bool _elevateExpiredPending;
    private bool _degraded;
    private long _eventsDropped;
    private long _overflowCount;
    private long _bytesUsed;
    private long _eventsStored;
    private int _probeInFlight;
    private DateTimeOffset? _lastCleanupUtc;
    private string _redactionMode = "none";

    public bool Enabled
    {
        get { lock (_gate) return _options.Enabled; }
    }

    public bool IsDegraded
    {
        get { lock (_gate) return _degraded; }
    }

    public void SetRedactionMode(string mode)
    {
        lock (_gate) _redactionMode = mode;
    }

    public void ApplyOptions(DiagnosticsOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        lock (_gate)
        {
            _options = options;
        }
    }

    public bool IsCapabilityEnabled(DiagnosticsDomain domain, DiagnosticsCapability capability)
    {
        lock (_gate)
        {
            ExpireElevateIfDue();
            return IsCapabilityEnabledUnlocked(domain, capability);
        }
    }

    public void SetElevate(TimeSpan? ttl)
    {
        lock (_gate)
        {
            _elevateExpiresUtc = ttl is null ? null : DateTimeOffset.UtcNow.Add(ttl.Value);
        }
    }

    public void ClearElevate()
    {
        lock (_gate)
        {
            _elevateExpiresUtc = null;
        }
    }

    public bool TryConsumeElevateExpired()
    {
        lock (_gate)
        {
            ExpireElevateIfDue();
            if (!_elevateExpiredPending)
                return false;
            _elevateExpiredPending = false;
            return true;
        }
    }

    public void ReportPublishDropped() => Interlocked.Increment(ref _eventsDropped);

    public void ReportOverflow() => Interlocked.Increment(ref _overflowCount);

    public void SetDegraded(bool degraded)
    {
        lock (_gate) _degraded = degraded;
    }

    public void UpdateStorageStats(long bytesUsed, long eventsStored, DateTimeOffset? lastCleanupUtc = null)
    {
        Interlocked.Exchange(ref _bytesUsed, bytesUsed);
        Interlocked.Exchange(ref _eventsStored, eventsStored);
        if (lastCleanupUtc is not null)
        {
            lock (_gate) _lastCleanupUtc = lastCleanupUtc;
        }
    }

    public IDisposable BeginProbe()
    {
        Interlocked.Increment(ref _probeInFlight);
        return new ProbeScope(this);
    }

    public DiagnosticsRuntimeSnapshot GetSnapshot()
    {
        lock (_gate)
        {
            ExpireElevateIfDue();
            var active = ElevateActiveUnlocked();
            var elevate = (object)new
            {
                active,
                expiresUtc = active ? _elevateExpiresUtc : null,
            };

            return new DiagnosticsRuntimeSnapshot
            {
                Enabled = _options.Enabled,
                Degraded = _degraded,
                EffectiveCapabilities = BuildEffectiveCapabilitiesUnlocked(),
                Elevate = elevate,
                ElevateActive = active,
                BytesUsed = Volatile.Read(ref _bytesUsed),
                StorageMaxBytes = _options.Storage.MaxBytes,
                EventsStored = Volatile.Read(ref _eventsStored),
                EventsDropped = Volatile.Read(ref _eventsDropped),
                OverflowCount = Volatile.Read(ref _overflowCount),
                ProbeInFlight = Volatile.Read(ref _probeInFlight),
                LastCleanupUtc = _lastCleanupUtc,
                DiagnosticsSchemaVersion = DiagnosticsSchema.Version,
                RedactionMode = _redactionMode,
                Options = _options,
            };
        }
    }

    private IReadOnlyDictionary<string, IReadOnlyDictionary<string, bool>> BuildEffectiveCapabilitiesUnlocked()
    {
        var result = new Dictionary<string, IReadOnlyDictionary<string, bool>>();

        void Add(DiagnosticsDomain domain, params DiagnosticsCapability[] caps)
        {
            var map = new Dictionary<string, bool>();
            foreach (var cap in caps)
                map[cap.ToString()] = IsCapabilityEnabledUnlocked(domain, cap);
            result[domain.ToString()] = map;
        }

        Add(DiagnosticsDomain.MotorLive, DiagnosticsCapability.Metric, DiagnosticsCapability.Event, DiagnosticsCapability.Snapshot);
        Add(DiagnosticsDomain.SidecarBrowser, DiagnosticsCapability.Metric, DiagnosticsCapability.Event);
        Add(DiagnosticsDomain.BrowserQuery, DiagnosticsCapability.Probe);
        Add(DiagnosticsDomain.PersistedSessions, DiagnosticsCapability.Snapshot);
        Add(DiagnosticsDomain.Telemetry, DiagnosticsCapability.Metric);
        Add(DiagnosticsDomain.DiagnosticsSelf, DiagnosticsCapability.Metric);
        return result;
    }

    private bool IsCapabilityEnabledUnlocked(DiagnosticsDomain domain, DiagnosticsCapability capability)
    {
        if (!_options.Enabled)
            return false;

        // Self is always on when diagnostics is enabled (ops evidence / audit).
        if (domain == DiagnosticsDomain.DiagnosticsSelf)
            return true;

        var enabled = ResolveToggleUnlocked(domain, capability);

        // Degraded caps everything except Metric (circuit breaker back-pressure).
        if (_degraded && capability != DiagnosticsCapability.Metric)
            enabled = false;

        // Elevate (TTL) forces BrowserQuery.Probe + Sidecar on — overrides Degraded for those.
        if (ElevateActiveUnlocked())
        {
            if (domain == DiagnosticsDomain.BrowserQuery && capability == DiagnosticsCapability.Probe)
                enabled = true;
            if (domain == DiagnosticsDomain.SidecarBrowser
                && capability is DiagnosticsCapability.Metric or DiagnosticsCapability.Event)
                enabled = true;
        }

        return enabled;
    }

    private bool ResolveToggleUnlocked(DiagnosticsDomain domain, DiagnosticsCapability capability)
    {
        var d = _options.Domains;
        return domain switch
        {
            DiagnosticsDomain.MotorLive => capability switch
            {
                DiagnosticsCapability.Metric => d.Motor.Metrics,
                DiagnosticsCapability.Event => d.Motor.Events,
                DiagnosticsCapability.Snapshot => d.Motor.Snapshots,
                _ => false,
            },
            DiagnosticsDomain.SidecarBrowser => capability switch
            {
                DiagnosticsCapability.Metric => d.Sidecar.Metrics,
                DiagnosticsCapability.Event => d.Sidecar.Events,
                _ => false,
            },
            DiagnosticsDomain.BrowserQuery => capability == DiagnosticsCapability.Probe && d.BrowserQuery.Probe,
            DiagnosticsDomain.PersistedSessions => capability == DiagnosticsCapability.Snapshot && d.Persisted.Snapshots,
            DiagnosticsDomain.Telemetry => capability == DiagnosticsCapability.Metric && _options.Telemetry.Enabled,
            _ => false,
        };
    }

    private bool ElevateActiveUnlocked()
        => _elevateExpiresUtc is { } expiry && DateTimeOffset.UtcNow < expiry;

    private void ExpireElevateIfDue()
    {
        if (_elevateExpiresUtc is { } expiry && DateTimeOffset.UtcNow >= expiry)
        {
            _elevateExpiredPending = true;
            _elevateExpiresUtc = null;
        }
    }

    private void EndProbe() => Interlocked.Decrement(ref _probeInFlight);

    private sealed class ProbeScope(DiagnosticsRuntime runtime) : IDisposable
    {
        private int _disposed;
        public void Dispose()
        {
            if (Interlocked.Exchange(ref _disposed, 1) == 0)
                runtime.EndProbe();
        }
    }
}
