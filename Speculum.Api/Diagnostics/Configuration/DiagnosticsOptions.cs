namespace Speculum.Api.Diagnostics.Configuration;

public sealed class DiagnosticsOptions
{
    public bool Enabled { get; init; } = true;

    /// <summary>Preset name that seeded these toggles (Development/Production/Assertive). Explicit toggles override the preset.</summary>
    public string Profile { get; init; } = "Production";

    public DiagnosticsDomainsOptions Domains { get; init; } = new();
    public DiagnosticsTelemetryOptions Telemetry { get; init; } = new();
    public DiagnosticsStorageOptions Storage { get; init; } = new();
    public DiagnosticsSamplingOptions Sampling { get; init; } = new();
    public DiagnosticsElevateOptions Elevate { get; init; } = new();
    public DiagnosticsProbeOptions Probe { get; init; } = new();
}

public sealed class DiagnosticsDomainsOptions
{
    public DiagnosticsMotorOptions Motor { get; init; } = new();
    public DiagnosticsSidecarOptions Sidecar { get; init; } = new();
    public DiagnosticsBrowserQueryOptions BrowserQuery { get; init; } = new();
    public DiagnosticsPersistedOptions Persisted { get; init; } = new();
}

public sealed class DiagnosticsMotorOptions
{
    public bool Metrics { get; init; } = true;
    public bool Events { get; init; } = true;
    public bool Snapshots { get; init; } = true;
}

public sealed class DiagnosticsSidecarOptions
{
    public bool Metrics { get; init; } = true;
    public bool Events { get; init; }
}

public sealed class DiagnosticsBrowserQueryOptions
{
    public bool Probe { get; init; }
}

public sealed class DiagnosticsPersistedOptions
{
    public bool Snapshots { get; init; } = true;
}

public sealed class DiagnosticsTelemetryOptions
{
    public bool Enabled { get; init; } = true;
    public int IntervalSeconds { get; init; } = 30;
    public TelemetryHostOptions Host { get; init; } = new();
    public TelemetryMotorOptions Motor { get; init; } = new();
    public TelemetrySidecarOptions Sidecar { get; init; } = new();
    public TelemetryPersistenceOptions Persistence { get; init; } = new();
    public TelemetryPipelineOptions Pipeline { get; init; } = new();
}

public sealed class TelemetryHostOptions
{
    public bool Enabled { get; init; } = true;
}

public sealed class TelemetryMotorOptions
{
    public bool Enabled { get; init; } = true;
    public bool IncludeSessionIds { get; init; }
    public bool IncludePerSession { get; init; }
    public bool IncludeUrlHost { get; init; }
}

public sealed class TelemetrySidecarOptions
{
    public bool Enabled { get; init; } = true;
    public bool IncludeFaultedIds { get; init; }
}

public sealed class TelemetryPersistenceOptions
{
    public bool Enabled { get; init; } = true;
    public bool IncludeBytes { get; init; }
}

public sealed class TelemetryPipelineOptions
{
    public bool Enabled { get; init; } = true;
    public bool IncludeBreakerPressure { get; init; }
}

public sealed class DiagnosticsStorageOptions
{
    public long MaxBytes { get; init; } = 64 * 1024 * 1024;
    public int MaxEventsPerSession { get; init; } = 5000;
    public int TtlHours { get; init; } = 24;
    public string Overflow { get; init; } = "DropOldest";
}

public sealed class DiagnosticsSamplingOptions
{
    public double StatusMirrorRatio { get; init; } = 1.0;
    public double ExpensiveEventRatio { get; init; } = 0.25;
}

public sealed class DiagnosticsElevateOptions
{
    public int BrowserQueryMaxMinutes { get; init; } = 30;
}

public sealed class DiagnosticsProbeOptions
{
    public int DiagTimeoutMs { get; init; } = 10_000;
    public int MaxConcurrentProbesPerSession { get; init; } = 2;
    public int MaxProbeResponseBytes { get; init; } = 512 * 1024;
    public int HostSampleIntervalMs { get; init; } = 1000;
}

public static class DiagnosticsSeedProfiles
{
    public static DiagnosticsOptions Development() => new()
    {
        Enabled = true,
        Profile = "Development",
        Domains = new DiagnosticsDomainsOptions
        {
            Motor = new DiagnosticsMotorOptions { Metrics = true, Events = true, Snapshots = true },
            Sidecar = new DiagnosticsSidecarOptions { Metrics = true, Events = true },
            BrowserQuery = new DiagnosticsBrowserQueryOptions { Probe = true },
            Persisted = new DiagnosticsPersistedOptions { Snapshots = true },
        },
        Telemetry = new DiagnosticsTelemetryOptions
        {
            Enabled = true,
            IntervalSeconds = 15,
            Motor = new TelemetryMotorOptions
            {
                Enabled = true,
                IncludeSessionIds = true,
                IncludePerSession = true,
                IncludeUrlHost = true,
            },
            Sidecar = new TelemetrySidecarOptions { Enabled = true, IncludeFaultedIds = true },
            Persistence = new TelemetryPersistenceOptions { Enabled = true, IncludeBytes = true },
            Pipeline = new TelemetryPipelineOptions { Enabled = true, IncludeBreakerPressure = true },
        },
        Storage = new DiagnosticsStorageOptions { TtlHours = 48, MaxBytes = 128 * 1024 * 1024 },
        Sampling = new DiagnosticsSamplingOptions { StatusMirrorRatio = 1.0, ExpensiveEventRatio = 1.0 },
    };

    public static DiagnosticsOptions Production() => new()
    {
        Enabled = true,
        Profile = "Production",
        Domains = new DiagnosticsDomainsOptions
        {
            Motor = new DiagnosticsMotorOptions { Metrics = true, Events = true, Snapshots = true },
            Sidecar = new DiagnosticsSidecarOptions { Metrics = true, Events = false },
            BrowserQuery = new DiagnosticsBrowserQueryOptions { Probe = false },
            Persisted = new DiagnosticsPersistedOptions { Snapshots = true },
        },
        Telemetry = new DiagnosticsTelemetryOptions
        {
            Enabled = true,
            IntervalSeconds = 30,
        },
        Storage = new DiagnosticsStorageOptions { TtlHours = 6, MaxBytes = 64 * 1024 * 1024 },
        Sampling = new DiagnosticsSamplingOptions { StatusMirrorRatio = 0.25, ExpensiveEventRatio = 0.25 },
    };

    public static DiagnosticsOptions Assertive() => new()
    {
        Enabled = true,
        Profile = "Assertive",
        Domains = new DiagnosticsDomainsOptions
        {
            Motor = new DiagnosticsMotorOptions { Metrics = true, Events = true, Snapshots = true },
            Sidecar = new DiagnosticsSidecarOptions { Metrics = true, Events = true },
            BrowserQuery = new DiagnosticsBrowserQueryOptions { Probe = true },
            Persisted = new DiagnosticsPersistedOptions { Snapshots = true },
        },
        Telemetry = new DiagnosticsTelemetryOptions
        {
            Enabled = true,
            IntervalSeconds = 10,
            Motor = new TelemetryMotorOptions
            {
                Enabled = true,
                IncludeSessionIds = true,
                IncludePerSession = true,
                IncludeUrlHost = true,
            },
            Sidecar = new TelemetrySidecarOptions { Enabled = true, IncludeFaultedIds = true },
            Persistence = new TelemetryPersistenceOptions { Enabled = true, IncludeBytes = true },
            Pipeline = new TelemetryPipelineOptions { Enabled = true, IncludeBreakerPressure = true },
        },
        Storage = new DiagnosticsStorageOptions { TtlHours = 72, MaxBytes = 256 * 1024 * 1024 },
        Sampling = new DiagnosticsSamplingOptions { StatusMirrorRatio = 1.0, ExpensiveEventRatio = 1.0 },
    };
}
