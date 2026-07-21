namespace Speculum.Api.Configurations.Models.Diagnostics;

public sealed class SidecarTelemetryConfiguration
{
    public bool IsEnabled { get; init; } = true;
    public bool IncludeFaultedSessionIds { get; init; } = true;
}
