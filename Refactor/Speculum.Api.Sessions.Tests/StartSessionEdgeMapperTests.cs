using Microsoft.Extensions.Options;
using Speculum.Api.Presentation.Sessions;
using Speculum.Api.Presentation.Sessions.Dtos;
using Speculum.Api.Sessions.Models;

namespace Speculum.Api.Sessions.Tests;

public sealed class StartSessionEdgeMapperTests
{
    [Fact]
    public void Map_MissingMimicry_FillsOnlyFromEngineConfiguration()
    {
        var configuration = SessionsTestHarness.Engine();

        var start = StartSessionEdgeMapper.Map(
            new StartSessionHubRequest
            {
                ProfileId = Guid.NewGuid(),
                Path = "/search",
            },
            "speculum.test:443",
            "caller",
            configuration);

        Assert.Equal(1280, start.ViewportWidth);
        Assert.Equal(720, start.ViewportHeight);
        Assert.Equal("speculum.test:443", start.RequestHost);
        Assert.NotNull(start.Device);
        Assert.Equal("desktop", start.Device.UserAgentProfile);
        Assert.NotNull(start.ClientEnvironment);
        Assert.Equal("en-US", start.ClientEnvironment.Locale);
        Assert.Equal("America/New_York", start.ClientEnvironment.TimeZoneId);
    }

    [Fact]
    public void Map_ClientMimicry_NormalizesAtEdgeOnce()
    {
        var configuration = SessionsTestHarness.Engine();

        var start = StartSessionEdgeMapper.Map(
            new StartSessionHubRequest
            {
                ProfileId = Guid.NewGuid(),
                ViewportWidth = 5000,
                ViewportHeight = 80,
                Device = new DeviceProfile
                {
                    Mobile = true,
                    DeviceScaleFactor = 9,
                },
                ClientEnvironment = new ClientEnvironmentHubRequest
                {
                    Locale = "pt-BR",
                    Language = "pt-BR",
                    TimeZoneId = "America/Sao_Paulo",
                    ColorScheme = "light",
                },
            },
            "speculum.test",
            "caller",
            configuration);

        Assert.Equal(4096, start.ViewportWidth);
        Assert.Equal(100, start.ViewportHeight);
        Assert.True(start.Device!.Touch);
        Assert.Equal(5, start.Device.MaxTouchPoints);
        Assert.Equal(2, start.Device.DeviceScaleFactor);
        Assert.Equal("mobile", start.Device.UserAgentProfile);
        Assert.Equal("pt-BR", start.ClientEnvironment!.Locale);
    }

    [Fact]
    public void Map_UsesConfiguredUserAgentProfiles()
    {
        var configuration = SessionsTestHarness.Engine();
        var sessions = configuration.Sessions;
        configuration.Sessions = new Configurations.Models.Sessions.SessionsConfiguration
        {
            DetachedSessionTimeout = sessions.DetachedSessionTimeout,
            IsJsBridgeEnabled = sessions.IsJsBridgeEnabled,
            ViewportPolicy = sessions.ViewportPolicy,
            ClientEnvironmentPolicy = sessions.ClientEnvironmentPolicy,
            DeviceEmulationPolicy = new Configurations.Models.Sessions.DeviceEmulationPolicy
            {
                Default = new Configurations.Models.Sessions.DeviceEmulationDefaults
                {
                    DeviceScaleFactor = 1,
                    UserAgentProfile = "wide",
                    ScreenOrientation = "landscapePrimary",
                },
                MinDeviceScaleFactor = 1,
                MaxDeviceScaleFactor = 2,
                MaxTouchPoints = 10,
                DefaultTouchPointsWhenTouch = 5,
                DesktopUserAgentProfile = "wide",
                MobileUserAgentProfile = "compact",
            },
        };

        var start = StartSessionEdgeMapper.Map(
            new StartSessionHubRequest
            {
                Device = new DeviceProfile
                {
                    Mobile = true,
                    DeviceScaleFactor = 1,
                    UserAgentProfile = "COMPACT",
                },
            },
            "speculum.test",
            "caller",
            configuration);

        Assert.Equal("compact", start.Device!.UserAgentProfile);
    }

    [Fact]
    public void Map_InvalidViewportPolicy_FailsInsteadOfInventingDefault()
    {
        var configuration = SessionsTestHarness.Engine();
        configuration.Sessions.ViewportPolicy =
            new Configurations.Models.Sessions.ViewportPolicy();

        Assert.Throws<InvalidOperationException>(() =>
            StartSessionEdgeMapper.Map(
                new StartSessionHubRequest(),
                "speculum.test",
                "caller",
                configuration));
    }

    [Fact]
    public void Map_UnsupportedColorScheme_FailsAtEdge()
    {
        Assert.Throws<ArgumentException>(() =>
            StartSessionEdgeMapper.Map(
                new StartSessionHubRequest
                {
                    ClientEnvironment = new ClientEnvironmentHubRequest
                    {
                        ColorScheme = "sepia",
                    },
                },
                "speculum.test",
                "caller",
                SessionsTestHarness.Engine()));
    }

    [Fact]
    public void SessionsConfigurationValidator_IncompletePolicies_Fails()
    {
        var result = new Configurations.Models.Sessions.SessionsConfigurationValidator()
            .Validate(null, new Configurations.Models.Sessions.SessionsConfiguration
            {
                DetachedSessionTimeout = TimeSpan.FromMinutes(1),
            });

        Assert.True(result.Failed);
    }
}
