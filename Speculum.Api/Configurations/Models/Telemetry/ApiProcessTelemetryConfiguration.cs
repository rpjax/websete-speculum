namespace Speculum.Api.Configurations.Models.Telemetry;

public sealed class ApiProcessTelemetryConfiguration
{
    public bool IsEnabled { get; init; } = true;

    /// <summary>Collector cache window (100..60000).</summary>
    public int SampleIntervalMs { get; init; } = 1000;

    public bool IncludePrivateMemory { get; init; } = true;
    public bool IncludeGarbageCollection { get; init; } = true;
    public bool IncludeThreadPool { get; init; } = true;
}
