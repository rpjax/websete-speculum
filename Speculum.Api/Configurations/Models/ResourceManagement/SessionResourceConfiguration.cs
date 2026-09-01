namespace Speculum.Api.Configurations.Models.ResourceManagement;

public sealed class SessionResourceConfiguration
{
    public int MaxConcurrentSessions { get; init; }
    public int MaxConcurrentSessionsPerProfile { get; init; }
    public int MaxPipesPerSession { get; init; }
    public TimeSpan MaxSessionDuration { get; init; }
}
