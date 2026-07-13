using Speculum.Api.Diagnostics.Abstractions;
using Speculum.Api.Diagnostics.Configuration;

namespace Speculum.Api.Diagnostics.Pipeline;

public sealed class DiagnosticsRuntime : IDiagnosticsRuntime
{
    private readonly object _gate = new();
    private DiagnosticsOptions _options = DiagnosticsSeedProfiles.Production();
    private DiagnosticsLevel? _elevateBrowserQueryFloor;
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

    public DiagnosticsLevel GetEffectiveLevel(DiagnosticsDomain domain)
    {
        lock (_gate)
        {
            if (!_options.Enabled)
                return DiagnosticsLevel.Off;

            var configured = ResolveConfiguredLevel(domain);
            if (_degraded && configured > DiagnosticsLevel.Metrics)
                configured = DiagnosticsLevel.Metrics;

            if (_elevateExpiresUtc is { } expiry && DateTimeOffset.UtcNow >= expiry)
            {
                if (_elevateBrowserQueryFloor is not null)
                    _elevateExpiredPending = true;
                _elevateBrowserQueryFloor = null;
                _elevateExpiresUtc = null;
            }

            if (_elevateBrowserQueryFloor is { } floor
                && domain is DiagnosticsDomain.BrowserQuery or DiagnosticsDomain.SidecarBrowser
                && configured < floor)
            {
                configured = floor;
            }

            return configured;
        }
    }

    public bool IsEnabled(DiagnosticsDomain domain, DiagnosticsLevel minimum)
        => GetEffectiveLevel(domain) >= minimum;

    public void SetElevate(DiagnosticsLevel? browserQueryFloor, TimeSpan? ttl)
    {
        lock (_gate)
        {
            _elevateBrowserQueryFloor = browserQueryFloor;
            _elevateExpiresUtc = browserQueryFloor is null || ttl is null
                ? null
                : DateTimeOffset.UtcNow.Add(ttl.Value);
        }
    }

    public void ClearElevate()
    {
        lock (_gate)
        {
            _elevateBrowserQueryFloor = null;
            _elevateExpiresUtc = null;
        }
    }

    public bool TryConsumeElevateExpired()
    {
        lock (_gate)
        {
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
            var elevate = _elevateBrowserQueryFloor is null
                ? null
                : (object)new
                {
                    browserQueryFloor = _elevateBrowserQueryFloor.ToString(),
                    expiresUtc = _elevateExpiresUtc,
                };

            return new DiagnosticsRuntimeSnapshot
            {
                Enabled = _options.Enabled,
                Degraded = _degraded,
                EffectiveLevels = new Dictionary<string, string>
                {
                    [nameof(DiagnosticsDomain.MotorLive)] = GetEffectiveLevelUnlocked(DiagnosticsDomain.MotorLive).ToString(),
                    [nameof(DiagnosticsDomain.SidecarBrowser)] = GetEffectiveLevelUnlocked(DiagnosticsDomain.SidecarBrowser).ToString(),
                    [nameof(DiagnosticsDomain.BrowserQuery)] = GetEffectiveLevelUnlocked(DiagnosticsDomain.BrowserQuery).ToString(),
                    [nameof(DiagnosticsDomain.PersistedSessions)] = GetEffectiveLevelUnlocked(DiagnosticsDomain.PersistedSessions).ToString(),
                    [nameof(DiagnosticsDomain.HostResources)] = GetEffectiveLevelUnlocked(DiagnosticsDomain.HostResources).ToString(),
                    [nameof(DiagnosticsDomain.DiagnosticsSelf)] = GetEffectiveLevelUnlocked(DiagnosticsDomain.DiagnosticsSelf).ToString(),
                },
                Elevate = elevate,
                BytesUsed = Volatile.Read(ref _bytesUsed),
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

    private DiagnosticsLevel GetEffectiveLevelUnlocked(DiagnosticsDomain domain)
    {
        if (!_options.Enabled)
            return DiagnosticsLevel.Off;

        var configured = ResolveConfiguredLevel(domain);
        if (_degraded && configured > DiagnosticsLevel.Metrics)
            configured = DiagnosticsLevel.Metrics;

        if (_elevateExpiresUtc is { } expiry && DateTimeOffset.UtcNow >= expiry)
        {
            if (_elevateBrowserQueryFloor is not null)
                _elevateExpiredPending = true;
            _elevateBrowserQueryFloor = null;
            _elevateExpiresUtc = null;
        }

        if (_elevateBrowserQueryFloor is { } floor
            && domain is DiagnosticsDomain.BrowserQuery or DiagnosticsDomain.SidecarBrowser
            && configured < floor)
        {
            configured = floor;
        }

        return configured;
    }

    private DiagnosticsLevel ResolveConfiguredLevel(DiagnosticsDomain domain)
    {
        var raw = domain switch
        {
            DiagnosticsDomain.MotorLive => _options.Domains.MotorLive,
            DiagnosticsDomain.SidecarBrowser => _options.Domains.SidecarBrowser,
            DiagnosticsDomain.BrowserQuery => _options.Domains.BrowserQuery,
            DiagnosticsDomain.PersistedSessions => _options.Domains.PersistedSessions,
            DiagnosticsDomain.HostResources => _options.Domains.HostResources,
            DiagnosticsDomain.DiagnosticsSelf => "Metrics",
            _ => _options.DefaultLevel,
        };

        return ParseLevel(raw, ParseLevel(_options.DefaultLevel, DiagnosticsLevel.Events));
    }

    internal static DiagnosticsLevel ParseLevel(string? value, DiagnosticsLevel fallback)
    {
        if (string.IsNullOrWhiteSpace(value))
            return fallback;
        return Enum.TryParse<DiagnosticsLevel>(value.Trim(), ignoreCase: true, out var level)
            ? level
            : fallback;
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
