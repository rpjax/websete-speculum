namespace Speculum.Api.Configurations.Models.Diagnostics;

public sealed class ProfileTelemetryConfiguration
{
    public bool IsEnabled { get; init; } = true;
    public bool IncludeStorageBytes { get; init; } = true;
}
