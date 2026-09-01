namespace Speculum.Api.Configurations.Models.ResourceManagement;

public sealed class DiagnosticsResourceConfiguration
{
    public int MaxConcurrentProbesPerSession { get; init; } = 2;
    public long MaxProbeResponseBytes { get; init; } = 512 * 1024;
    public TimeSpan MaxElevationDuration { get; init; } = TimeSpan.FromMinutes(30);
}
