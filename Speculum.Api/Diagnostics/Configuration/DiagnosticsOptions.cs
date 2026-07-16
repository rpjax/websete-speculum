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
    public TelemetryApiProcessOptions ApiProcess { get; init; } = new();
    public TelemetryMotorOptions Motor { get; init; } = new();
    public TelemetrySidecarOptions Sidecar { get; init; } = new();
    public TelemetryPersistenceOptions Persistence { get; init; } = new();
    public TelemetryPipelineOptions Pipeline { get; init; } = new();
}

/// <summary>Machine/VPS telemetry section — core always on when Enabled; include* and paths are section settings.</summary>
public sealed class TelemetryHostOptions
{
    public bool Enabled { get; init; } = true;
    public string ProcPath { get; init; } = "/proc";
    /// <summary>Null/empty = auto (app/data root). Otherwise the path whose volume is measured.</summary>
    public string? DiskPath { get; init; }
    public int SampleIntervalMs { get; init; } = 1000;
    public bool IncludeLoadAverage { get; init; } = true;
    public bool IncludeSwap { get; init; } = true;
    public bool IncludeDiskIo { get; init; }
    public bool IncludeNetwork { get; init; }
}

/// <summary>Speculum.Api process + CLR telemetry section.</summary>
public sealed class TelemetryApiProcessOptions
{
    public bool Enabled { get; init; } = true;
    public int SampleIntervalMs { get; init; } = 1000;
    public bool IncludePrivateMemory { get; init; } = true;
    public bool IncludeGc { get; init; } = true;
    public bool IncludeThreadPool { get; init; } = true;
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
    public long MaxBytes { get; init; } = 16L * 1024 * 1024 * 1024;
    public int MaxEventsPerSession { get; init; } = 50_000;
    public int TtlHours { get; init; } = 30 * 24;
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
            Host = new TelemetryHostOptions
            {
                Enabled = true,
                ProcPath = "/proc",
                SampleIntervalMs = 1000,
                IncludeLoadAverage = true,
                IncludeSwap = true,
                IncludeDiskIo = true,
                IncludeNetwork = true,
            },
            ApiProcess = new TelemetryApiProcessOptions
            {
                Enabled = true,
                SampleIntervalMs = 1000,
                IncludePrivateMemory = true,
                IncludeGc = true,
                IncludeThreadPool = true,
            },
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
        Storage = new DiagnosticsStorageOptions
        {
            TtlHours = 30 * 24,
            MaxBytes = 16L * 1024 * 1024 * 1024,
            MaxEventsPerSession = 50_000,
        },
        Sampling = new DiagnosticsSamplingOptions { StatusMirrorRatio = 1.0, ExpensiveEventRatio = 1.0 },
    };

    public static DiagnosticsOptions Production() => new()
    {
        Enabled = true,
        Profile = "Production",
        Domains = new DiagnosticsDomainsOptions
        {
            Motor = new DiagnosticsMotorOptions { Metrics = true, Events = true, Snapshots = true },
            Sidecar = new DiagnosticsSidecarOptions { Metrics = true, Events = true },
            BrowserQuery = new DiagnosticsBrowserQueryOptions { Probe = false },
            Persisted = new DiagnosticsPersistedOptions { Snapshots = true },
        },
        Telemetry = new DiagnosticsTelemetryOptions
        {
            Enabled = true,
            IntervalSeconds = 30,
            Host = new TelemetryHostOptions
            {
                Enabled = true,
                ProcPath = "/host/proc",
                SampleIntervalMs = 1000,
                IncludeLoadAverage = true,
                IncludeSwap = true,
                IncludeDiskIo = false,
                IncludeNetwork = false,
            },
            ApiProcess = new TelemetryApiProcessOptions
            {
                Enabled = true,
                SampleIntervalMs = 1000,
                IncludePrivateMemory = true,
                IncludeGc = true,
                IncludeThreadPool = true,
            },
            Motor = new TelemetryMotorOptions
            {
                Enabled = true,
                IncludeSessionIds = true,
                IncludePerSession = false,
                IncludeUrlHost = true,
            },
            Sidecar = new TelemetrySidecarOptions { Enabled = true, IncludeFaultedIds = true },
            Persistence = new TelemetryPersistenceOptions { Enabled = true, IncludeBytes = true },
            Pipeline = new TelemetryPipelineOptions { Enabled = true, IncludeBreakerPressure = true },
        },
        Storage = new DiagnosticsStorageOptions
        {
            TtlHours = 30 * 24,
            MaxBytes = 16L * 1024 * 1024 * 1024,
            MaxEventsPerSession = 50_000,
        },
        Sampling = new DiagnosticsSamplingOptions { StatusMirrorRatio = 0.5, ExpensiveEventRatio = 0.25 },
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
            Host = new TelemetryHostOptions
            {
                Enabled = true,
                ProcPath = "/host/proc",
                SampleIntervalMs = 1000,
                IncludeLoadAverage = true,
                IncludeSwap = true,
                IncludeDiskIo = true,
                IncludeNetwork = true,
            },
            ApiProcess = new TelemetryApiProcessOptions
            {
                Enabled = true,
                SampleIntervalMs = 1000,
                IncludePrivateMemory = true,
                IncludeGc = true,
                IncludeThreadPool = true,
            },
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
        Storage = new DiagnosticsStorageOptions
        {
            TtlHours = 90 * 24,
            MaxBytes = 32L * 1024 * 1024 * 1024,
            MaxEventsPerSession = 100_000,
        },
        Sampling = new DiagnosticsSamplingOptions { StatusMirrorRatio = 1.0, ExpensiveEventRatio = 1.0 },
    };
}
