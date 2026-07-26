using Speculum.Api.Configurations.Models.Sessions;
using Speculum.Api.Configurations.Services.Contracts;
using Speculum.Api.Presentation.Sessions.Dtos;
using Speculum.Api.Sessions.Models;
using Speculum.Api.Sessions.Requests;

namespace Speculum.Api.Presentation.Sessions;

internal static class StartSessionEdgeMapper
{
    public static StartSession Map(
        StartSessionHubRequest request,
        string requestHost,
        string callerId,
        EngineConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(configuration);

        var sessions = configuration.Sessions;
        var policyValidation = new SessionsConfigurationValidator()
            .Validate(null, sessions);
        if (policyValidation.Failed)
        {
            throw new InvalidOperationException(
                string.Join("; ", policyValidation.Failures));
        }

        var viewport = sessions.ViewportPolicy;
        var width = request.ViewportWidth > 0
            ? request.ViewportWidth
            : viewport.Default.Width;
        var height = request.ViewportHeight > 0
            ? request.ViewportHeight
            : viewport.Default.Height;

        return new StartSession
        {
            CallerId = callerId,
            ProfileId = request.ProfileId,
            Path = request.Path ?? string.Empty,
            Query = request.Query ?? string.Empty,
            RequestHost = requestHost,
            ViewportWidth = Math.Clamp(width, viewport.Minimum.Width, viewport.Maximum.Width),
            ViewportHeight = Math.Clamp(height, viewport.Minimum.Height, viewport.Maximum.Height),
            Device = NormalizeDevice(request.Device, sessions.DeviceEmulationPolicy),
            ClientEnvironment = NormalizeEnvironment(
                request.ClientEnvironment,
                sessions.ClientEnvironmentPolicy),
        };
    }

    private static DeviceProfile NormalizeDevice(
        DeviceProfile? input,
        DeviceEmulationPolicy policy)
    {
        if (input is null)
        {
            return new DeviceProfile
            {
                Mobile = policy.Default.Mobile,
                Touch = policy.Default.Touch,
                DeviceScaleFactor = policy.Default.DeviceScaleFactor,
                MaxTouchPoints = policy.Default.MaxTouchPoints,
                UserAgentProfile = policy.Default.UserAgentProfile.Trim().ToLowerInvariant(),
                ScreenOrientation = policy.Default.ScreenOrientation.Trim(),
            };
        }

        var scale = double.IsFinite(input.DeviceScaleFactor)
            ? input.DeviceScaleFactor
            : policy.MinDeviceScaleFactor;
        scale = Math.Clamp(
            scale <= 0 ? policy.MinDeviceScaleFactor : scale,
            policy.MinDeviceScaleFactor,
            policy.MaxDeviceScaleFactor);

        var touch = input.Touch || input.Mobile;
        var touchPoints = Math.Clamp(input.MaxTouchPoints, 0, policy.MaxTouchPoints);
        if (touch && touchPoints == 0)
        {
            touchPoints = policy.DefaultTouchPointsWhenTouch;
        }

        var userAgentProfile = input.UserAgentProfile?.Trim();
        if (string.Equals(
                userAgentProfile,
                policy.DesktopUserAgentProfile,
                StringComparison.OrdinalIgnoreCase))
        {
            userAgentProfile = policy.DesktopUserAgentProfile;
        }
        else if (string.Equals(
                     userAgentProfile,
                     policy.MobileUserAgentProfile,
                     StringComparison.OrdinalIgnoreCase))
        {
            userAgentProfile = policy.MobileUserAgentProfile;
        }
        else
        {
            userAgentProfile = input.Mobile
                ? policy.MobileUserAgentProfile
                : policy.DesktopUserAgentProfile;
        }

        return new DeviceProfile
        {
            Mobile = input.Mobile,
            Touch = touch,
            DeviceScaleFactor = scale,
            MaxTouchPoints = touchPoints,
            UserAgentProfile = userAgentProfile.Trim().ToLowerInvariant(),
            ScreenOrientation = string.IsNullOrWhiteSpace(input.ScreenOrientation)
                ? policy.Default.ScreenOrientation
                : input.ScreenOrientation.Trim(),
        };
    }

    private static ClientEnvironment NormalizeEnvironment(
        ClientEnvironmentHubRequest? input,
        ClientEnvironmentPolicy policy)
        => new()
        {
            Locale = ValueOrConfigured(input?.Locale, policy.DefaultLocale),
            Language = ValueOrConfigured(input?.Language, policy.DefaultLanguage),
            TimeZoneId = ValueOrConfigured(input?.TimeZoneId, policy.DefaultTimeZoneId),
            ColorScheme = NormalizeColorScheme(
                input?.ColorScheme,
                policy.DefaultColorScheme),
            Geolocation = input?.Geolocation is null
                ? null
                : new Geolocation
                {
                    Latitude = input.Geolocation.Latitude,
                    Longitude = input.Geolocation.Longitude,
                    Accuracy = input.Geolocation.Accuracy,
                },
        };

    private static string ValueOrConfigured(string? value, string configured)
        => (string.IsNullOrWhiteSpace(value) ? configured : value).Trim();

    private static string NormalizeColorScheme(string? value, string configured)
    {
        var normalized = ValueOrConfigured(value, configured);
        if (!ClientEnvironmentPolicy.IsSupportedColorScheme(normalized))
        {
            throw new ArgumentException(
                "ColorScheme must be light, dark, or no-preference",
                nameof(value));
        }

        return normalized.ToLowerInvariant();
    }
}
