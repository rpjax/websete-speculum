namespace Speculum.Api.Diagnostics.Configuration;

public sealed class DiagnosticsOptions
{
    public bool Enabled { get; init; } = true;
    public string DefaultLevel { get; init; } = "Events";
    public DiagnosticsDomainLevels Domains { get; init; } = new();
    public DiagnosticsStorageOptions Storage { get; init; } = new();
    public DiagnosticsSamplingOptions Sampling { get; init; } = new();
    public DiagnosticsElevateOptions Elevate { get; init; } = new();
    public DiagnosticsProbeOptions Probe { get; init; } = new();
}

public sealed class DiagnosticsDomainLevels
{
    public string MotorLive { get; init; } = "Events";
    public string SidecarBrowser { get; init; } = "Metrics";
    public string HostResources { get; init; } = "Metrics";
    public string BrowserQuery { get; init; } = "Off";
    public string PersistedSessions { get; init; } = "StateSnapshots";
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
        DefaultLevel = "Events",
        Domains = new DiagnosticsDomainLevels
        {
            MotorLive = "Events",
            SidecarBrowser = "Events",
            HostResources = "Metrics",
            BrowserQuery = "BrowserQuery",
            PersistedSessions = "StateSnapshots",
        },
        Storage = new DiagnosticsStorageOptions { TtlHours = 48, MaxBytes = 128 * 1024 * 1024 },
        Sampling = new DiagnosticsSamplingOptions { StatusMirrorRatio = 1.0, ExpensiveEventRatio = 1.0 },
    };

    public static DiagnosticsOptions Production() => new()
    {
        Enabled = true,
        DefaultLevel = "Events",
        Domains = new DiagnosticsDomainLevels
        {
            MotorLive = "Events",
            SidecarBrowser = "Metrics",
            HostResources = "Metrics",
            BrowserQuery = "Off",
            PersistedSessions = "StateSnapshots",
        },
        Storage = new DiagnosticsStorageOptions { TtlHours = 6, MaxBytes = 64 * 1024 * 1024 },
        Sampling = new DiagnosticsSamplingOptions { StatusMirrorRatio = 0.25, ExpensiveEventRatio = 0.25 },
    };

    public static DiagnosticsOptions Assertive() => new()
    {
        Enabled = true,
        DefaultLevel = "BrowserQuery",
        Domains = new DiagnosticsDomainLevels
        {
            MotorLive = "BrowserQuery",
            SidecarBrowser = "BrowserQuery",
            HostResources = "Metrics",
            BrowserQuery = "BrowserQuery",
            PersistedSessions = "BrowserQuery",
        },
        Storage = new DiagnosticsStorageOptions { TtlHours = 72, MaxBytes = 256 * 1024 * 1024 },
        Sampling = new DiagnosticsSamplingOptions { StatusMirrorRatio = 1.0, ExpensiveEventRatio = 1.0 },
    };
}
