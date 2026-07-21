namespace Speculum.Api.Configurations.Models.Diagnostics;

public sealed class PipelineTelemetryConfiguration
{
    public bool IsEnabled { get; init; } = true;
    public bool IncludePressure { get; init; } = true;
}
