namespace Speculum.Api.Diagnostics.Abstractions;

public static class DiagnosticsSchema
{
    public const int Version = 1;
}

/// <summary>
/// The kind of signal an event carries. Metadata per event (via the catalog descriptor),
/// NOT an operator control — operators toggle capabilities per domain in config.
/// Mirrors the Signal vocabulary in docs/diagnostics.md.
/// </summary>
public enum DiagnosticsCapability
{
    Metric,
    Event,
    Snapshot,
    Probe,
}

public enum DiagnosticsDomain
{
    MotorLive,
    SidecarBrowser,
    BrowserQuery,
    PersistedSessions,
    Telemetry,
    DiagnosticsSelf,
}

public enum DiagnosticsSeverity
{
    Information,
    Warning,
    Error,
}

public enum MotorSessionPhase
{
    Starting,
    Running,
    Stopping,
    Stopped,
}
