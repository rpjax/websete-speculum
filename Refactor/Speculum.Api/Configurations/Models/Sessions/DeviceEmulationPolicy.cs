namespace Speculum.Api.Configurations.Models.Sessions;

public sealed class DeviceEmulationPolicy
{
    public DeviceEmulationDefaults Default { get; init; } = new();
    public double MinDeviceScaleFactor { get; init; }
    public double MaxDeviceScaleFactor { get; init; }
    public int MaxTouchPoints { get; init; }
    public int DefaultTouchPointsWhenTouch { get; init; }
    public string DesktopUserAgentProfile { get; init; } = "";
    public string MobileUserAgentProfile { get; init; } = "";
    /// <summary>Optional tablet kit id (default <c>tablet</c> when empty at normalize).</summary>
    public string TabletUserAgentProfile { get; init; } = "tablet";
}
