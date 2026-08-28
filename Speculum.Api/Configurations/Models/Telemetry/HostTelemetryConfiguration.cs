namespace Speculum.Api.Configurations.Models.Telemetry;

public sealed class HostTelemetryConfiguration
{
    public bool IsEnabled { get; init; } = true;

    /// <summary>Procfs root (e.g. <c>/proc</c> or dockup <c>/host/proc</c>).</summary>
    public string ProcPath { get; init; } = "/proc";

    /// <summary>Null/empty = auto (content root). Otherwise the path whose volume is measured.</summary>
    public string? DiskPath { get; init; }

    /// <summary>Collector cache window (100..60000).</summary>
    public int SampleIntervalMs { get; init; } = 1000;

    public bool IncludeLoadAverage { get; init; } = true;
    public bool IncludeSwap { get; init; } = true;
    public bool IncludeDiskIo { get; init; }
    public bool IncludeNetwork { get; init; }
}
