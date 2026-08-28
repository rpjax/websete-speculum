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
        var tabletProfile = string.IsNullOrWhiteSpace(policy.TabletUserAgentProfile)
            ? "tablet"
            : policy.TabletUserAgentProfile.Trim().ToLowerInvariant();
        var desktopProfile = policy.DesktopUserAgentProfile.Trim().ToLowerInvariant();
        var mobileProfile = policy.MobileUserAgentProfile.Trim().ToLowerInvariant();

        if (input is null)
        {
            var defaultCategory = ResolveCategory(
                null,
                policy.Default.UserAgentProfile,
                policy.Default.Mobile,
                desktopProfile,
                mobileProfile,
                tabletProfile);
            var defaultFloors = ApplyKitFloors(
                policy.Default.Mobile,
                policy.Default.Touch,
                policy.Default.MaxTouchPoints,
                defaultCategory,
                policy);
            return new DeviceProfile
            {
                Mobile = defaultFloors.Mobile,
                Touch = defaultFloors.Touch,
                DeviceScaleFactor = policy.Default.DeviceScaleFactor,
                MaxTouchPoints = defaultFloors.MaxTouchPoints,
                UserAgentProfile = ProfileForCategory(
                    defaultCategory,
                    desktopProfile,
                    mobileProfile,
                    tabletProfile),
                DeviceCategory = defaultCategory,
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

        var category = ResolveCategory(
            input.DeviceCategory,
            input.UserAgentProfile,
            input.Mobile,
            desktopProfile,
            mobileProfile,
            tabletProfile);
        var floors = ApplyKitFloors(
            input.Mobile,
            input.Touch,
            input.MaxTouchPoints,
            category,
            policy);

        return new DeviceProfile
        {
            Mobile = floors.Mobile,
            Touch = floors.Touch,
            DeviceScaleFactor = scale,
            MaxTouchPoints = floors.MaxTouchPoints,
            UserAgentProfile = ProfileForCategory(
                category,
                desktopProfile,
                mobileProfile,
                tabletProfile),
            DeviceCategory = category,
            ScreenOrientation = string.IsNullOrWhiteSpace(input.ScreenOrientation)
                ? policy.Default.ScreenOrientation
                : input.ScreenOrientation.Trim(),
        };
    }

    private static string ResolveCategory(
        string? deviceCategory,
        string? userAgentProfile,
        bool mobile,
        string desktopProfile,
        string mobileProfile,
        string tabletProfile)
    {
        var cat = deviceCategory?.Trim().ToLowerInvariant();
        if (cat is "phone" or "tablet" or "pc")
        {
            return cat;
        }

        var profile = userAgentProfile?.Trim().ToLowerInvariant() ?? "";
        if (profile is "phone" or "mobile" || profile == mobileProfile)
        {
            return "phone";
        }

        if (profile is "tablet" || profile == tabletProfile)
        {
            return "tablet";
        }

        if (profile is "pc" or "desktop" || profile == desktopProfile)
        {
            return "pc";
        }

        return mobile ? "phone" : "pc";
    }

    private static string ProfileForCategory(
        string category,
        string desktopProfile,
        string mobileProfile,
        string tabletProfile)
        => category switch
        {
            "phone" => string.IsNullOrWhiteSpace(mobileProfile) ? "mobile" : mobileProfile,
            "tablet" => tabletProfile,
            _ => string.IsNullOrWhiteSpace(desktopProfile) ? "desktop" : desktopProfile,
        };

    private static (bool Mobile, bool Touch, int MaxTouchPoints) ApplyKitFloors(
        bool mobile,
        bool touch,
        int maxTouchPoints,
        string category,
        DeviceEmulationPolicy policy)
    {
        var points = Math.Clamp(maxTouchPoints, 0, policy.MaxTouchPoints);
        if (category is "phone" or "tablet")
        {
            var floor = Math.Max(1, policy.DefaultTouchPointsWhenTouch);
            if (points < floor)
            {
                points = floor;
            }

            return (true, true, points);
        }

        // pc: do not force touch; ensure points when touch enabled
        touch = touch || mobile;
        mobile = false;
        if (touch && points == 0)
        {
            points = policy.DefaultTouchPointsWhenTouch;
        }

        return (mobile, touch, points);
    }

    private static ClientEnvironment NormalizeEnvironment(
        ClientEnvironmentHubRequest? input,
        ClientEnvironmentPolicy policy)
    {
        var language = ValueOrConfigured(input?.Language, policy.DefaultLanguage);
        var languages = NormalizeLanguages(input?.Languages, language);
        if (languages.Count > 0)
        {
            // Accept-Language prefers the full list when the client sent one.
            language = string.Join(",", languages);
        }

        return new()
        {
            Locale = ValueOrConfigured(input?.Locale, policy.DefaultLocale),
            Language = language,
            TimeZoneId = ValueOrConfigured(input?.TimeZoneId, policy.DefaultTimeZoneId),
            ColorScheme = NormalizeColorScheme(
                input?.ColorScheme,
                policy.DefaultColorScheme),
            Languages = languages,
            Geolocation = input?.Geolocation is null
                ? null
                : new Geolocation
                {
                    Latitude = input.Geolocation.Latitude,
                    Longitude = input.Geolocation.Longitude,
                    Accuracy = input.Geolocation.Accuracy,
                },
        };
    }

    private static IReadOnlyList<string> NormalizeLanguages(
        IReadOnlyList<string>? input,
        string primaryLanguage)
    {
        var list = new List<string>();
        if (input is not null)
        {
            foreach (var raw in input)
            {
                var part = raw?.Trim();
                if (string.IsNullOrWhiteSpace(part))
                {
                    continue;
                }

                if (!list.Contains(part, StringComparer.OrdinalIgnoreCase))
                {
                    list.Add(part);
                }

                if (list.Count >= 8)
                {
                    break;
                }
            }
        }

        if (list.Count == 0 && !string.IsNullOrWhiteSpace(primaryLanguage))
        {
            list.Add(primaryLanguage.Trim());
        }

        return list;
    }

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
