namespace Speculum.Api.Configurations.Models.Sessions;

public sealed class DeviceEmulationDefaults
{
    public bool Mobile { get; init; }
    public bool Touch { get; init; }
    public double DeviceScaleFactor { get; init; }
    public int MaxTouchPoints { get; init; }
    public string UserAgentProfile { get; init; } = "";
    public string ScreenOrientation { get; init; } = "";
}
