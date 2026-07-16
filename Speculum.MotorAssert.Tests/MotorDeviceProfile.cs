using MessagePack;

namespace Speculum.MotorAssert.Tests;

/// <summary>Mirrors Speculum.Api DeviceProfile for MessagePack hub invokes.</summary>
[MessagePackObject]
public sealed class MotorDeviceProfile
{
    [Key("mobile")]
    public bool Mobile { get; init; }

    [Key("touch")]
    public bool Touch { get; init; }

    [Key("deviceScaleFactor")]
    public double DeviceScaleFactor { get; init; } = 1;

    [Key("maxTouchPoints")]
    public int MaxTouchPoints { get; init; }

    [Key("userAgentProfile")]
    public string? UserAgentProfile { get; init; }

    [Key("screenOrientation")]
    public string? ScreenOrientation { get; init; }
}
