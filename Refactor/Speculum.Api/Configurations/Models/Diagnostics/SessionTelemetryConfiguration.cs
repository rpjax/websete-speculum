namespace Speculum.Api.Configurations.Models.Diagnostics;

public sealed class SessionTelemetryConfiguration
{
    public bool IsEnabled { get; init; } = true;
    public bool IncludeSessionIds { get; init; } = true;
    public bool IncludePerSession { get; init; }
    public bool IncludeUrlHost { get; init; } = true;
}
