using System.Text.Json;
using Websete.Speculum.Host.Config.Runtime;
using Websete.Speculum.Host.Config.Store;

namespace Websete.Speculum.Host.Tests;

public class DomainMatcherTests
{
    [Theory]
    [InlineData("www.olx.com.br", "*.olx.com.br", true)]
    [InlineData("contas.olx.com.br", "*.olx.com.br", true)]
    [InlineData("olx.com.br", "*.olx.com.br", false)]
    [InlineData("olx.com.br", "olx.com.br", true)]
    [InlineData("evil.com", "olx.com.br", false)]
    public void Matches_WildcardAndExact(string host, string pattern, bool expected)
        => Assert.Equal(expected, DomainMatcher.Matches(host, pattern));
}

public class InitialUrlBuilderTests
{
    [Fact]
    public void Build_PreservesPathAndQuery()
    {
        var url = InitialUrlBuilder.Build("www.olx.com.br", "https://proxy.local/cars?q=1");
        Assert.Equal("https://www.olx.com.br/cars?q=1", url);
    }

    [Fact]
    public void Build_RejectsInvalidClientUrl()
        => Assert.Throws<ArgumentException>(() =>
            InitialUrlBuilder.Build("www.olx.com.br", "not-a-url"));
}

public class ConfigValidatorTests
{
    [Fact]
    public void Forwarding_RejectsHostNotInDomains()
    {
        var json = JsonDocument.Parse("""
            { "host": "www.other.com", "domains": ["*.olx.com.br"] }
            """).RootElement;

        var ex = Assert.Throws<ConfigValidationException>(() =>
            ConfigValidator.ValidateSection(ConfigSectionKeys.Forwarding, json, webRootPath: null));

        Assert.Contains(ex.Errors, e => e.Path.Contains("host"));
    }

    [Fact]
    public void Environment_RejectsUnknownValue()
    {
        var json = JsonDocument.Parse("\"Staging\"").RootElement;
        Assert.Throws<ConfigValidationException>(() =>
            ConfigValidator.ValidateSection(ConfigSectionKeys.Environment, json, webRootPath: null));
    }
}
