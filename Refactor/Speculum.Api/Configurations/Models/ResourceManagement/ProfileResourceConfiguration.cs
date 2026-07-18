namespace Speculum.Api.Configurations.Models.ResourceManagement;

public sealed class ProfileResourceConfiguration
{
    public TimeSpan InactiveRetentionPeriod { get; init; } = TimeSpan.FromDays(30);
    public int MaxNavigationHistoryEntries { get; init; } = 500;
}
