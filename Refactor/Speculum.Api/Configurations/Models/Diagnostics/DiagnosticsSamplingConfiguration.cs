namespace Speculum.Api.Configurations.Models.Diagnostics;

public sealed class DiagnosticsSamplingConfiguration
{
    public double StatusRatio { get; init; } = 0.5;
    public double ExpensiveEventRatio { get; init; } = 0.25;
}
