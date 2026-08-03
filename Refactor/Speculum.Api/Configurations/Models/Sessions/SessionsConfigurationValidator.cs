using Microsoft.Extensions.Options;
using Speculum.Api.Configurations.Models.Sessions;

namespace Speculum.Api.Configurations.Models.Sessions;

public sealed class SessionsConfigurationValidator : IValidateOptions<SessionsConfiguration>
{
    public ValidateOptionsResult Validate(string? name, SessionsConfiguration options)
    {
        if (IsEmpty(options))
            return ValidateOptionsResult.Success;

        if (options.DetachedSessionTimeout <= TimeSpan.Zero)
        {
            return ValidateOptionsResult.Fail(
                "Sessions.DetachedSessionTimeout must be greater than zero.");
        }

        if (!Enum.IsDefined(options.DataStreamTransport))
        {
            return ValidateOptionsResult.Fail(
                "Sessions.DataStreamTransport must be webTransport or webSocket.");
        }

        var viewport = options.ViewportPolicy;
        if (!IsPositive(viewport.Minimum)
            || !IsPositive(viewport.Default)
            || !IsPositive(viewport.Maximum)
            || viewport.Minimum.Width > viewport.Default.Width
            || viewport.Minimum.Height > viewport.Default.Height
            || viewport.Default.Width > viewport.Maximum.Width
            || viewport.Default.Height > viewport.Maximum.Height)
        {
            return ValidateOptionsResult.Fail(
                "Sessions.ViewportPolicy must satisfy 0 < Minimum <= Default <= Maximum.");
        }

        var environment = options.ClientEnvironmentPolicy;
        if (string.IsNullOrWhiteSpace(environment.DefaultLocale)
            || string.IsNullOrWhiteSpace(environment.DefaultLanguage)
            || string.IsNullOrWhiteSpace(environment.DefaultTimeZoneId)
            || !ClientEnvironmentPolicy.IsSupportedColorScheme(
                environment.DefaultColorScheme))
        {
            return ValidateOptionsResult.Fail(
                "Sessions.ClientEnvironmentPolicy defaults are required and DefaultColorScheme must be light, dark, or no-preference.");
        }

        var device = options.DeviceEmulationPolicy;
        if (!double.IsFinite(device.MinDeviceScaleFactor)
            || !double.IsFinite(device.MaxDeviceScaleFactor)
            || device.MinDeviceScaleFactor <= 0
            || device.MinDeviceScaleFactor > device.MaxDeviceScaleFactor
            || device.MaxTouchPoints < 0
            || device.DefaultTouchPointsWhenTouch < 0
            || device.DefaultTouchPointsWhenTouch > device.MaxTouchPoints
            || !double.IsFinite(device.Default.DeviceScaleFactor)
            || device.Default.DeviceScaleFactor < device.MinDeviceScaleFactor
            || device.Default.DeviceScaleFactor > device.MaxDeviceScaleFactor
            || device.Default.MaxTouchPoints < 0
            || device.Default.MaxTouchPoints > device.MaxTouchPoints
            || string.IsNullOrWhiteSpace(device.Default.UserAgentProfile)
            || string.IsNullOrWhiteSpace(device.Default.ScreenOrientation)
            || string.IsNullOrWhiteSpace(device.DesktopUserAgentProfile)
            || string.IsNullOrWhiteSpace(device.MobileUserAgentProfile)
            || (!device.Default.UserAgentProfile.Equals(
                    device.DesktopUserAgentProfile,
                    StringComparison.OrdinalIgnoreCase)
                && !device.Default.UserAgentProfile.Equals(
                    device.MobileUserAgentProfile,
                    StringComparison.OrdinalIgnoreCase)
                && !device.Default.UserAgentProfile.Equals(
                    string.IsNullOrWhiteSpace(device.TabletUserAgentProfile)
                        ? "tablet"
                        : device.TabletUserAgentProfile,
                    StringComparison.OrdinalIgnoreCase)
                && !device.Default.UserAgentProfile.Equals("phone", StringComparison.OrdinalIgnoreCase)
                && !device.Default.UserAgentProfile.Equals("pc", StringComparison.OrdinalIgnoreCase)
                && !device.Default.UserAgentProfile.Equals("tablet", StringComparison.OrdinalIgnoreCase)))
        {
            return ValidateOptionsResult.Fail(
                "Sessions.DeviceEmulationPolicy is incomplete or has invalid bounds.");
        }

        return ValidateOptionsResult.Success;
    }

    private static bool IsEmpty(SessionsConfiguration options)
    {
        var viewport = options.ViewportPolicy;
        return options.DetachedSessionTimeout <= TimeSpan.Zero
            && viewport.Minimum.Width == 0
            && viewport.Minimum.Height == 0
            && viewport.Default.Width == 0
            && viewport.Default.Height == 0
            && viewport.Maximum.Width == 0
            && viewport.Maximum.Height == 0
            && string.IsNullOrWhiteSpace(options.ClientEnvironmentPolicy.DefaultLocale);
    }

    private static bool IsPositive(ScreenResolution resolution)
        => resolution.Width > 0 && resolution.Height > 0;
}
