using Microsoft.Extensions.Options;
using Speculum.Api.Configurations.Models.Navigation;
using Speculum.Api.Configurations.Models.Sessions;
using Speculum.Api.Configurations.Services.Contracts;
using Speculum.Api.Sessions.Models;
using Speculum.Api.Sessions.Requests;

namespace Speculum.Api.Sessions.Tests;

internal sealed class SessionsTestOptionsMonitor<T> : IOptionsMonitor<T>
{
    private readonly T _value;

    public SessionsTestOptionsMonitor(T value) => _value = value;

    public T CurrentValue => _value;

    public T Get(string? name) => _value;

    public IDisposable? OnChange(Action<T, string?> listener) => null;
}

internal static class SessionsTestHarness
{
    public static Configurations.Models.ResourceManagement.ResourceManagementConfiguration ResourceManagement(
        int maxConcurrentSessions = 2)
        => new()
        {
            Sessions = new Configurations.Models.ResourceManagement.SessionResourceConfiguration
            {
                MaxConcurrentSessions = maxConcurrentSessions,
            },
        };

    public static Configurations.Models.Sessions.SessionsConfiguration Sessions(
        TimeSpan? detachedTimeout = null)
        => new()
        {
            DetachedSessionTimeout = detachedTimeout ?? TimeSpan.FromMilliseconds(200),
            IsJsBridgeEnabled = true,
            ViewportPolicy = new ViewportPolicy
            {
                Default = new Configurations.Models.Sessions.ScreenResolution { Width = 1280, Height = 720 },
                Minimum = new Configurations.Models.Sessions.ScreenResolution { Width = 100, Height = 100 },
                Maximum = new Configurations.Models.Sessions.ScreenResolution { Width = 4096, Height = 2160 },
            },
            ClientEnvironmentPolicy = new ClientEnvironmentPolicy
            {
                DefaultLocale = "en-US",
                DefaultLanguage = "en-US",
                DefaultTimeZoneId = "America/New_York",
                DefaultColorScheme = "dark",
            },
            DeviceEmulationPolicy = new DeviceEmulationPolicy
            {
                Default = new DeviceEmulationDefaults
                {
                    DeviceScaleFactor = 1,
                    UserAgentProfile = "desktop",
                    ScreenOrientation = "landscapePrimary",
                },
                MinDeviceScaleFactor = 1,
                MaxDeviceScaleFactor = 2,
                MaxTouchPoints = 10,
                DefaultTouchPointsWhenTouch = 5,
                DesktopUserAgentProfile = "desktop",
                MobileUserAgentProfile = "mobile",
            },
        };

    public static EngineConfiguration Engine(string targetHost = "example.test") => new()
    {
        Navigation = new NavigationConfiguration
        {
            DefaultTargetHost = targetHost,
        },
        Sessions = Sessions(),
        ResourceManagement = ResourceManagement(),
    };

    public static StartSession Start(Guid profileId) => new()
    {
        CallerId = Guid.NewGuid().ToString("N"),
        ProfileId = profileId,
        Path = "/",
        Query = "",
        RequestHost = "speculum.test",
        ViewportWidth = 800,
        ViewportHeight = 600,
        Device = new DeviceProfile
        {
            DeviceScaleFactor = 1,
            UserAgentProfile = "desktop",
            ScreenOrientation = "landscapePrimary",
        },
        ClientEnvironment = new ClientEnvironment
        {
            Locale = "en-US",
            Language = "en-US",
            TimeZoneId = "America/New_York",
            ColorScheme = "dark",
        },
    };

    public sealed class StaticConfigurationService(EngineConfiguration configuration)
        : IConfigurationService
    {
        public EngineConfiguration GetCurrent() => configuration;
    }
}
