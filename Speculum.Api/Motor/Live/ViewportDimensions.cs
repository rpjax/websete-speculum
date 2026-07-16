namespace Speculum.Api.Motor.Live;

internal static class ViewportDimensions
{
    public const int DefaultWidth = 1280;
    public const int DefaultHeight = 720;
    public const int MinWidth = 100;
    public const int MinHeight = 100;
    /// <summary>Aligned with sidecar Xvfb framebuffer ceiling.</summary>
    public const int MaxWidth = 4096;
    public const int MaxHeight = 2160;
    public const double MinDeviceScaleFactor = 1;
    public const double MaxDeviceScaleFactor = 2;
    public const int MaxTouchPoints = 10;

    public static (int Width, int Height) Normalize(int viewportWidth, int viewportHeight)
    {
        var w = viewportWidth > 0 ? viewportWidth : DefaultWidth;
        var h = viewportHeight > 0 ? viewportHeight : DefaultHeight;
        w = Math.Clamp(w, 1, MaxWidth);
        h = Math.Clamp(h, 1, MaxHeight);
        return (w, h);
    }

    public static DeviceProfile NormalizeDevice(DeviceProfile? device)
    {
        if (device is null)
        {
            return new DeviceProfile
            {
                Mobile = false,
                Touch = false,
                DeviceScaleFactor = 1,
                MaxTouchPoints = 0,
            };
        }

        var dpr = device.DeviceScaleFactor;
        if (!double.IsFinite(dpr) || dpr <= 0) dpr = 1;
        dpr = Math.Clamp(dpr, MinDeviceScaleFactor, MaxDeviceScaleFactor);

        var maxPoints = device.MaxTouchPoints;
        if (maxPoints < 0) maxPoints = 0;
        if (maxPoints > MaxTouchPoints) maxPoints = MaxTouchPoints;

        var touch = device.Touch || device.Mobile;
        if (touch && maxPoints == 0) maxPoints = 5;

        var ua = device.UserAgentProfile;
        if (ua is not null
            && !string.Equals(ua, "desktop", StringComparison.OrdinalIgnoreCase)
            && !string.Equals(ua, "mobile", StringComparison.OrdinalIgnoreCase))
        {
            ua = device.Mobile ? "mobile" : "desktop";
        }

        return new DeviceProfile
        {
            Mobile = device.Mobile,
            Touch = touch,
            DeviceScaleFactor = dpr,
            MaxTouchPoints = maxPoints,
            UserAgentProfile = ua ?? (device.Mobile ? "mobile" : "desktop"),
            ScreenOrientation = device.ScreenOrientation,
        };
    }
}
