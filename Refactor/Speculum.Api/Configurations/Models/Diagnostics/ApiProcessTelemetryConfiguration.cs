namespace Speculum.Api.Configurations.Models.Diagnostics;

public sealed class ApiProcessTelemetryConfiguration
{
    public bool IsEnabled { get; init; } = true;
    public bool IncludePrivateMemory { get; init; } = true;
    public bool IncludeGarbageCollection { get; init; } = true;
    public bool IncludeThreadPool { get; init; } = true;
}
