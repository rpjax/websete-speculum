namespace Speculum.Api.Configurations.Models.Sessions;

public class SessionsConfiguration
{
    public TimeSpan DetachedSessionTimeout { get; init; }
    public bool IsJsBridgeEnabled { get; set; }
    public ViewportPolicy ViewportPolicy { get; set; } = new();
    public InputMultiplexingPolicy InputMultiplexingPolicy { get; init; } = new();
    public OutputMultiplexingPolicy OutputMultiplexingPolicy { get; init; } = new();
}
