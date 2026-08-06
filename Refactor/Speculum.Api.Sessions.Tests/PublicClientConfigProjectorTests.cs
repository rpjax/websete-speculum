using Speculum.Api.Configurations.Models.Hosting;
using Speculum.Api.Configurations.Models.Navigation;
using Speculum.Api.Configurations.Models.ResourceManagement;
using Speculum.Api.Configurations.Models.Sessions;
using Speculum.Api.Configurations.Services.Contracts;
using Speculum.Api.Presentation.Bootstrap;
using Speculum.Api.Sessions.Services;

namespace Speculum.Api.Sessions.Tests;

public sealed class PublicClientConfigProjectorTests
{
    [Fact]
    public void Project_IncludesPreStartSessionsSurfaceAndPolicy()
    {
        var projector = new PublicClientConfigProjector();
        var engine = new EngineConfiguration
        {
            Navigation = new NavigationConfiguration { DefaultTargetHost = "www.example.com" },
            Sessions = new SessionsConfiguration
            {
                DetachedSessionTimeout = TimeSpan.FromMinutes(30),
                DataStreamTransport = DataStreamTransportKind.WebSocket,
                MirrorMode = MirrorMode.DomProjection,
                ViewportPolicy = new ViewportPolicy
                {
                    Minimum = new ScreenResolution { Width = 100, Height = 100 },
                    Default = new ScreenResolution { Width = 1280, Height = 720 },
                    Maximum = new ScreenResolution { Width = 4096, Height = 2160 },
                },
                ScreencastPolicy = new ScreencastPolicy { MaxEncodeScale = 1.5 },
            },
            ResourceManagement = new ResourceManagementConfiguration
            {
                Sessions = new SessionResourceConfiguration
                {
                    MaxConcurrentSessions = 4,
                },
            },
            Hosting = new HostingConfiguration
            {
                Domains =
                [
                    new DomainConfiguration
                    {
                        Domain = "lab.example.com",
                        IsSubdomainMirroringEnabled = true,
                    },
                ],
            },
        };

        var dto = projector.Project(engine, operational: true, missing: [], requestHost: "lab.example.com");

        Assert.Equal(1, dto.SchemaVersion);
        Assert.True(dto.Operational);
        Assert.Equal(UrlResolver.NavigationStateParameterName, dto.NsoParamName);
        Assert.Equal("www.example.com", dto.Navigation.DefaultTargetHost);
        Assert.Equal("webSocket", dto.Sessions.DataStreamTransport);
        Assert.Equal("domProjection", dto.Sessions.MirrorMode);
        Assert.Equal(100, dto.Sessions.ViewportPolicy.MinWidth);
        Assert.Equal(4096, dto.Sessions.ViewportPolicy.MaxWidth);
        Assert.Equal(1.5, dto.Sessions.ScreencastMaxEncodeScale);
        Assert.Equal(4, dto.ResourceManagement.MaxConcurrentSessions);
        Assert.Equal("lab.example.com", dto.Hosting.CurrentDomain);
    }
}
