namespace Speculum.Api.Configurations.Models.Diagnostics;

public sealed class TelemetryConfiguration
{
    public bool IsEnabled { get; init; } = true;
    public TimeSpan Interval { get; init; } = TimeSpan.FromSeconds(30);
    public HostTelemetryConfiguration Host { get; init; } = new();
    public ApiProcessTelemetryConfiguration ApiProcess { get; init; } = new();
    public SessionTelemetryConfiguration Sessions { get; init; } = new();
    public SidecarTelemetryConfiguration Sidecar { get; init; } = new();
    public ProfileTelemetryConfiguration Profiles { get; init; } = new();
    public PipelineTelemetryConfiguration Pipeline { get; init; } = new();
}
