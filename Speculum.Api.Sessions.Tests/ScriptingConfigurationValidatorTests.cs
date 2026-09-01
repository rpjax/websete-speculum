using Speculum.Api.Configurations.Models.Patterns;
using Speculum.Api.Configurations.Models.Scripting;
using Speculum.Api.Sessions.Services;

namespace Speculum.Api.Sessions.Tests;

public sealed class ScriptingConfigurationValidatorTests
{
    [Fact]
    public void Validate_RejectsEmptyTargetRules()
    {
        var config = new ScriptingConfiguration
        {
            Injections =
            [
                new ScriptInjectionConfiguration
                {
                    Source = new ScriptSourceConfiguration
                    {
                        SourceType = ScriptSourceType.Remote,
                        RemoteUrl = new Uri("https://cdn.example.com/a.js"),
                    },
                    ExecutionType = ScriptExecutionType.Classic,
                    TargetRules = [],
                },
            ],
        };

        var result = new ScriptingConfigurationValidator().Validate(null, config);

        Assert.False(result.Succeeded);
        Assert.Contains(result.Failures!, f => f.Contains("TargetRules", StringComparison.Ordinal));
    }

    [Fact]
    public void Validate_RejectsSourceTypeMismatch()
    {
        var config = new ScriptingConfiguration
        {
            Injections =
            [
                new ScriptInjectionConfiguration
                {
                    Source = new ScriptSourceConfiguration
                    {
                        SourceType = ScriptSourceType.Stored,
                        RemoteUrl = new Uri("https://cdn.example.com/a.js"),
                    },
                    ExecutionType = ScriptExecutionType.Classic,
                    TargetRules =
                    [
                        new UrlMatchRule
                        {
                            Domain = new DomainPattern { Scope = PatternScope.Any },
                            Path = new PathPattern { Scope = PatternScope.Any },
                        },
                    ],
                },
            ],
        };

        var result = new ScriptingConfigurationValidator().Validate(null, config);

        Assert.False(result.Succeeded);
    }

    [Fact]
    public void Validate_RejectsMidLabelWildcard()
    {
        var config = new ScriptingConfiguration
        {
            Injections =
            [
                new ScriptInjectionConfiguration
                {
                    Source = new ScriptSourceConfiguration
                    {
                        SourceType = ScriptSourceType.Remote,
                        RemoteUrl = new Uri("https://cdn.example.com/a.js"),
                    },
                    ExecutionType = ScriptExecutionType.Classic,
                    TargetRules =
                    [
                        new UrlMatchRule
                        {
                            Domain = new DomainPattern
                            {
                                Scope = PatternScope.Pattern,
                                Labels =
                                [
                                    new DomainLabelPattern { Match = PatternPartMatch.Exact, Value = "api" },
                                    new DomainLabelPattern { Match = PatternPartMatch.Any, Value = "" },
                                    new DomainLabelPattern { Match = PatternPartMatch.Exact, Value = "com" },
                                ],
                            },
                            Path = new PathPattern { Scope = PatternScope.Any },
                        },
                    ],
                },
            ],
        };

        var result = new ScriptingConfigurationValidator().Validate(null, config);

        Assert.False(result.Succeeded);
        Assert.Contains(result.Failures!, f => f.Contains("leading '*'", StringComparison.Ordinal));
    }
}

public sealed class RemoteScriptFetcherValidationTests
{
    [Theory]
    [InlineData("http://127.0.0.1/x.js")]
    [InlineData("http://10.0.0.5/x.js")]
    [InlineData("http://192.168.1.2/x.js")]
    [InlineData("http://169.254.1.1/x.js")]
    [InlineData("http://localhost/x.js")]
    [InlineData("http://0.0.0.0/x.js")]
    [InlineData("http://100.64.1.1/x.js")]
    [InlineData("http://[::ffff:10.0.0.1]/x.js")]
    public async Task ValidatePublicHttpUrl_RejectsPrivateHosts(string url)
    {
        var result = await RemoteScriptFetcher.ValidatePublicHttpUrlAsync(new Uri(url));
        Assert.True(result.IsFailure);
    }

    [Fact]
    public void IsPublicIp_RejectsRfc1918()
    {
        Assert.False(PublicHttpUrlPolicy.IsPublicIp(System.Net.IPAddress.Parse("10.1.2.3")));
        Assert.False(PublicHttpUrlPolicy.IsPublicIp(System.Net.IPAddress.Parse("172.16.0.1")));
        Assert.False(PublicHttpUrlPolicy.IsPublicIp(System.Net.IPAddress.Parse("192.168.0.1")));
        Assert.False(PublicHttpUrlPolicy.IsPublicIp(System.Net.IPAddress.Parse("0.0.0.0")));
        Assert.False(PublicHttpUrlPolicy.IsPublicIp(System.Net.IPAddress.Parse("100.64.0.1")));
        Assert.False(PublicHttpUrlPolicy.IsPublicIp(System.Net.IPAddress.Parse("::ffff:10.0.0.1")));
        Assert.True(PublicHttpUrlPolicy.IsPublicIp(System.Net.IPAddress.Parse("8.8.8.8")));
    }

    [Fact]
    public void ValidateRemoteUrl_RejectsMappedPrivateLiteral()
    {
        var failure = ScriptingConfigurationValidator.ValidateRemoteUrl(
            new Uri("http://[::ffff:192.168.0.1]/a.js"),
            0);
        Assert.NotNull(failure);
    }
}
