namespace Speculum.Api.Configurations.Models.Diagnostics;

public sealed class HostTelemetryConfiguration
{
    public bool IsEnabled { get; init; } = true;
    public bool IncludeLoadAverage { get; init; } = true;
    public bool IncludeSwap { get; init; } = true;
    public bool IncludeDiskIo { get; init; }
    public bool IncludeNetwork { get; init; }
}
