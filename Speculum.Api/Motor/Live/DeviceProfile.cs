using MessagePack;

namespace Speculum.Api.Motor.Live;

/// <summary>
/// Optional mobile/desktop emulation profile for StartSession / Resize.
/// MessagePack keys are camelCase for the web client.
/// </summary>
[MessagePackObject]
public sealed class DeviceProfile
{
    [Key("mobile")]
    public bool Mobile { get; init; }

    [Key("touch")]
    public bool Touch { get; init; }

    [Key("deviceScaleFactor")]
    public double DeviceScaleFactor { get; init; } = 1;

    [Key("maxTouchPoints")]
    public int MaxTouchPoints { get; init; }

    /// <summary>Stable profile id — not a free-form UA string from the client.</summary>
    [Key("userAgentProfile")]
    public string? UserAgentProfile { get; init; }

    [Key("screenOrientation")]
    public string? ScreenOrientation { get; init; }
}
