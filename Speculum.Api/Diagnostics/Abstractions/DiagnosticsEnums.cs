namespace Speculum.Api.Diagnostics.Abstractions;

public static class DiagnosticsSchema
{
    public const int Version = 1;
}

public enum DiagnosticsLevel
{
    Off = 0,
    Metrics = 1,
    Events = 2,
    StateSnapshots = 3,
    BrowserQuery = 4,
}

public enum DiagnosticsDomain
{
    MotorLive,
    SidecarBrowser,
    BrowserQuery,
    PersistedSessions,
    HostResources,
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
