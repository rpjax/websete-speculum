namespace Speculum.Api.ResourceMonitoring.Models;

public enum ResourceSignalKind
{
    ApiMemoryLeak,
    HostSaturation,
    RenderRegression,
    ThreadStarvation,
    SessionCapacitySaturation,
    SidecarInstability,
    JournalStress,
}

public enum ResourceSignalSeverity
{
    Info,
    Warning,
    Critical,
}

public enum ResourceSignalStatus
{
    Active,
    Resolved,
}

public enum ResourceReportKind
{
    ResourceTrend,
    LeakSuspect,
    SaturationWindow,
    JournalHealth,
}

public enum ResourceReportStatus
{
    Pending,
    Ready,
    Failed,
}
