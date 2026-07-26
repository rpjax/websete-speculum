using Speculum.Api.Configurations.Models.Hosting;
using Speculum.Api.Configurations.Models.Navigation;
using Speculum.Api.Configurations.Models.Patterns;
using Speculum.Api.Sessions.Services;
using System.Text;
using System.Text.Json;

namespace Speculum.Api.Sessions.Tests;

public sealed class UrlResolverTests
{
    [Fact]
    public void Resolve_BootstrapHost_BuildsConfiguredTargetAndStripsValidNavigationState()
    {
        var configuration = SessionsTestHarness.Engine("www.target.test");
        configuration.Navigation = Navigation(
            "www.target.test",
            ExactDomain("target", "test"),
            WildcardDomain("target", "test"));
        var resolver = new UrlResolver(
            new SessionsTestHarness.StaticConfigurationService(configuration));

        var result = resolver.Resolve(
            "/search",
            $"q=1&_w7s_nso={EncodeNavigationState("")}",
            "bootstrap.speculum.test:443");

        Assert.True(result.IsSuccess);
        Assert.Equal("https://www.target.test/search?q=1", result.Value);
    }

    [Fact]
    public void Resolve_OpaqueNavigationState_Fails()
    {
        var resolver = new UrlResolver(
            new SessionsTestHarness.StaticConfigurationService(
                SessionsTestHarness.Engine("www.target.test")));

        Assert.True(resolver.Resolve(
            "/search",
            "q=1&_w7s_nso=opaque",
            "bootstrap.speculum.test:443").IsFailure);
    }

    [Fact]
    public void Resolve_ApexNavigationState_MapsLabelToConfiguredTargetApex()
    {
        var configuration = SessionsTestHarness.Engine("www.olx.com.br");
        configuration.Navigation = Navigation(
            "www.olx.com.br",
            ExactDomain("www", "olx", "com", "br"),
            ExactDomain("olx", "com", "br"),
            WildcardDomain("olx", "com", "br"));
        configuration.Hosting = new HostingConfiguration
        {
            Domains =
            [
                new DomainConfiguration
                {
                    Domain = "speculum.test",
                    IsSubdomainMirroringEnabled = false,
                },
            ],
        };
        var resolver = new UrlResolver(
            new SessionsTestHarness.StaticConfigurationService(configuration));

        var result = resolver.Resolve(
            "/listing",
            $"q=1&_w7s_nso={EncodeNavigationState("cars")}",
            "speculum.test");

        Assert.True(result.IsSuccess);
        Assert.Equal("https://cars.olx.com.br/listing?q=1", result.Value);
    }

    [Fact]
    public void Resolve_MirroredSubdomain_UsesConfiguredApexWithoutStrippingIt()
    {
        var configuration = SessionsTestHarness.Engine("olx.com.br");
        configuration.Navigation = Navigation(
            "olx.com.br",
            ExactDomain("olx", "com", "br"),
            WildcardDomain("olx", "com", "br"));
        configuration.Hosting = new HostingConfiguration
        {
            Domains =
            [
                new DomainConfiguration
                {
                    Domain = "speculum.test",
                    IsSubdomainMirroringEnabled = true,
                },
            ],
        };
        var resolver = new UrlResolver(
            new SessionsTestHarness.StaticConfigurationService(configuration));

        var result = resolver.Resolve("/listing", "", "cars.speculum.test");

        Assert.True(result.IsSuccess);
        Assert.Equal("https://cars.olx.com.br/listing", result.Value);
    }

    [Fact]
    public void Resolve_MirroredMultiLabelSubdomain_IsAllowed()
    {
        var configuration = SessionsTestHarness.Engine("olx.com.br");
        configuration.Navigation = Navigation(
            "olx.com.br",
            ExactDomain("olx", "com", "br"),
            WildcardDomain("olx", "com", "br"));
        configuration.Hosting = new HostingConfiguration
        {
            Domains =
            [
                new DomainConfiguration
                {
                    Domain = "speculum.test",
                    IsSubdomainMirroringEnabled = true,
                },
            ],
        };
        var resolver = new UrlResolver(
            new SessionsTestHarness.StaticConfigurationService(configuration));

        var result = resolver.Resolve("/api", "", "api.v2.speculum.test");

        Assert.True(result.IsSuccess);
        Assert.Equal("https://api.v2.olx.com.br/api", result.Value);
    }

    [Fact]
    public void Resolve_WwwSessionWithMirroring_MapsToWwwTargetApex()
    {
        var configuration = SessionsTestHarness.Engine("olx.com.br");
        configuration.Navigation = Navigation(
            "olx.com.br",
            ExactDomain("olx", "com", "br"),
            WildcardDomain("olx", "com", "br"));
        configuration.Hosting = new HostingConfiguration
        {
            Domains =
            [
                new DomainConfiguration
                {
                    Domain = "speculum.test",
                    IsSubdomainMirroringEnabled = true,
                },
            ],
        };
        var resolver = new UrlResolver(
            new SessionsTestHarness.StaticConfigurationService(configuration));

        var result = resolver.Resolve(
            "/",
            $"_w7s_nso={EncodeNavigationState("cars")}",
            "www.speculum.test");

        Assert.True(result.IsSuccess);
        Assert.Equal("https://www.olx.com.br/", result.Value);
    }

    [Fact]
    public void Resolve_MirroringWithoutConfiguredTargetApex_Fails()
    {
        var configuration = SessionsTestHarness.Engine("www.target.test");
        configuration.Hosting = new HostingConfiguration
        {
            Domains =
            [
                new DomainConfiguration
                {
                    Domain = "speculum.test",
                    IsSubdomainMirroringEnabled = true,
                },
            ],
        };
        var resolver = new UrlResolver(
            new SessionsTestHarness.StaticConfigurationService(configuration));

        Assert.True(resolver.Resolve("/", "", "cars.speculum.test").IsFailure);
    }

    [Fact]
    public void Resolve_PatternScopeAny_AllowsAnyValidHost()
    {
        var configuration = SessionsTestHarness.Engine("www.target.test");
        configuration.Navigation = new NavigationConfiguration
        {
            DefaultTargetHost = "www.target.test",
            AllowedMainFrameUrls =
            [
                new UrlMatchRule
                {
                    Domain = new DomainPattern { Scope = PatternScope.Any },
                },
            ],
        };
        var resolver = new UrlResolver(
            new SessionsTestHarness.StaticConfigurationService(configuration));

        var result = resolver.Resolve(
            "/search",
            $"q=1&_w7s_nso={EncodeNavigationState("www.google.com")}",
            "speculum.test");

        Assert.True(result.IsSuccess);
        Assert.Equal("https://www.google.com/search?q=1", result.Value);
    }

    [Fact]
    public void Resolve_MissingRequestHost_Fails()
    {
        var resolver = new UrlResolver(
            new SessionsTestHarness.StaticConfigurationService(
                SessionsTestHarness.Engine()));

        Assert.True(resolver.Resolve("/", "", "").IsFailure);
    }

    private static NavigationConfiguration Navigation(
        string defaultTargetHost,
        params DomainPattern[] domains)
        => new()
        {
            DefaultTargetHost = defaultTargetHost,
            AllowedMainFrameUrls = domains
                .Select(domain => new UrlMatchRule { Domain = domain })
                .ToArray(),
        };

    private static DomainPattern ExactDomain(params string[] labels)
        => new()
        {
            Scope = PatternScope.Pattern,
            Labels = labels
                .Select(value => new DomainLabelPattern
                {
                    Match = PatternPartMatch.Exact,
                    Value = value,
                })
                .ToArray(),
        };

    private static DomainPattern WildcardDomain(params string[] apexLabels)
        => new()
        {
            Scope = PatternScope.Pattern,
            Labels =
            [
                new DomainLabelPattern { Match = PatternPartMatch.Any },
                .. apexLabels.Select(value => new DomainLabelPattern
                {
                    Match = PatternPartMatch.Exact,
                    Value = value,
                }),
            ],
        };

    private static string EncodeNavigationState(string host)
    {
        var json = JsonSerializer.Serialize(new { v = 1, h = host });
        return Uri.EscapeDataString(
            Convert.ToBase64String(Encoding.UTF8.GetBytes(json)));
    }
}
