namespace Speculum.Api.Configurations.Models.Sessions;

public sealed class ViewportPolicy
{
    public ScreenResolution Default { get; init; } = new();
    public ScreenResolution Minimum { get; init; } = new();
    public ScreenResolution Maximum { get; init; } = new();
}
