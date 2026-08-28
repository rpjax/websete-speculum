using Microsoft.Extensions.Options;
using Speculum.Api.Configurations.Models.Hosting;
using Speculum.Api.Configurations.Models.Journal;
using Speculum.Api.Configurations.Models.Navigation;
using Speculum.Api.Configurations.Models.ResourceManagement;
using Speculum.Api.Configurations.Models.Sessions;
using Speculum.Api.Configurations.Services.Contracts;
using Speculum.Api.Sessions.Models;
using Speculum.Api.Sessions.Requests;
using Speculum.Api.Sessions.Services.Contracts;

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
        Hosting = new HostingConfiguration(),
        Navigation = new NavigationConfiguration { DefaultTargetHost = targetHost },
        Sessions = Sessions(TimeSpan.FromMinutes(5)),
        ResourceManagement = ResourceManagement(10),
    };

    public static StaticConfigurationService Configuration(
        SessionsConfiguration? sessions = null,
        string targetHost = "example.test",
        int maxConcurrentSessions = 10)
        => new(new EngineConfiguration
        {
            Hosting = new HostingConfiguration(),
            Navigation = new NavigationConfiguration { DefaultTargetHost = targetHost },
            Sessions = sessions ?? Sessions(TimeSpan.FromMinutes(5)),
            ResourceManagement = ResourceManagement(maxConcurrentSessions),
        });

    public static StartSession Start(Guid profileId) => new()
    {
        CallerId = Guid.NewGuid().ToString("N"),
        AttachedClient = new NoOpAttachedSessionClient(),
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

    private sealed class NoOpAttachedSessionClient : IAttachedSessionClient
    {
        public Task SyncUrlAsync(string url, CancellationToken cancellationToken = default)
            => Task.CompletedTask;

        public Task RedirectAsync(string url, CancellationToken cancellationToken = default)
            => Task.CompletedTask;

        public Task EditableFocusChangedAsync(
            Speculum.Api.Sessions.Models.EditingState? editing,
            CancellationToken cancellationToken = default)
            => Task.CompletedTask;

        public Task SessionEndedAsync(
            Guid sessionId,
            string reason,
            string? errorCode = null,
            string? message = null,
            CancellationToken cancellationToken = default)
            => Task.CompletedTask;
    }

    public sealed class StaticConfigurationService(EngineConfiguration configuration)
        : IConfigurationService
    {
        private EngineConfiguration _configuration = configuration;
        private readonly List<string> _missing = [];

        public EngineConfiguration GetCurrent() => _configuration;

        public JournalEventsConfiguration GetJournalEvents() => new();

        public bool AreMandatorySettingsSatisfied => _missing.Count == 0;

        public IReadOnlyList<string> MissingRequired => _missing;

        public void ReplaceApplied(
            EngineConfiguration configuration,
            JournalEventsConfiguration journalEvents,
            IReadOnlyList<string> missingRequired)
        {
            _configuration = configuration;
            _missing.Clear();
            _missing.AddRange(missingRequired);
        }

        public void SetHosting(HostingConfiguration hosting)
            => _configuration = CloneWith(hosting: hosting);

        public void SetNavigation(NavigationConfiguration navigation)
            => _configuration = CloneWith(navigation: navigation);

        private EngineConfiguration CloneWith(
            HostingConfiguration? hosting = null,
            NavigationConfiguration? navigation = null)
            => new()
            {
                Hosting = hosting ?? _configuration.Hosting,
                Navigation = navigation ?? _configuration.Navigation,
                Sessions = _configuration.Sessions,
                Profiles = _configuration.Profiles,
                ResourceManagement = _configuration.ResourceManagement,
                Scripting = _configuration.Scripting,
                Diagnostics = _configuration.Diagnostics,
            };
    }
}
