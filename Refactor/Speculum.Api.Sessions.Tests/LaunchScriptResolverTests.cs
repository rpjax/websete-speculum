using Microsoft.Extensions.DependencyInjection;
using Speculum.Api.Configurations.Models.Patterns;
using Speculum.Api.Configurations.Models.Scripting;
using Speculum.Api.Scripts.Services.Contracts;
using Speculum.Api.Scripts.Storage;
using Speculum.Api.Sessions.Services;
using Speculum.Api.Sessions.Services.Contracts;

namespace Speculum.Api.Sessions.Tests;

public sealed class LaunchScriptResolverTests
{
    [Fact]
    public async Task ResolveAsync_MapsStoredAndRemoteSources_WithTargetRules()
    {
        var storedId = Guid.NewGuid();
        var services = new ServiceCollection();
        services.AddScoped<IScriptRepository>(_ => new FakeScriptRepository(storedId, "console.log('stored');"));
        var provider = services.BuildServiceProvider();
        var resolver = new LaunchScriptResolver(
            provider.GetRequiredService<IServiceScopeFactory>(),
            new FakeRemoteScriptFetcher("console.log('remote');"));

        var config = new ScriptingConfiguration
        {
            Injections =
            [
                new ScriptInjectionConfiguration
                {
                    Source = new ScriptSourceConfiguration
                    {
                        SourceType = ScriptSourceType.Stored,
                        StoredScriptId = storedId,
                    },
                    Position = ScriptInjectionPosition.HeadStart,
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
                                    new DomainLabelPattern { Match = PatternPartMatch.Exact, Value = "example" },
                                    new DomainLabelPattern { Match = PatternPartMatch.Exact, Value = "com" },
                                ],
                            },
                            Path = new PathPattern
                            {
                                Scope = PatternScope.Pattern,
                                MatchType = PathMatchType.Prefix,
                                Segments =
                                [
                                    new PathSegmentPattern { Match = PatternPartMatch.Exact, Value = "app" },
                                ],
                            },
                        },
                    ],
                },
                new ScriptInjectionConfiguration
                {
                    Source = new ScriptSourceConfiguration
                    {
                        SourceType = ScriptSourceType.Remote,
                        RemoteUrl = new Uri("https://cdn.example.com/script.js"),
                    },
                    Position = ScriptInjectionPosition.BodyEnd,
                    ExecutionType = ScriptExecutionType.Module,
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

        var resolved = await resolver.ResolveAsync(config);

        Assert.True(resolved.IsSuccess);
        Assert.Equal(2, resolved.Value.Count);
        Assert.Equal("HeaderTop", resolved.Value[0].Position);
        Assert.Equal("Classic", resolved.Value[0].Type);
        Assert.Equal("console.log('stored');", resolved.Value[0].Content);
        Assert.Single(resolved.Value[0].TargetRules);
        Assert.Equal("BodyBottom", resolved.Value[1].Position);
        Assert.Equal("Module", resolved.Value[1].Type);
        Assert.Equal("console.log('remote');", resolved.Value[1].Content);
    }

    private sealed class FakeRemoteScriptFetcher(string content) : IRemoteScriptFetcher
    {
        public Task<Aidan.Core.Patterns.IResult<string>> FetchAsync(Uri remoteUrl, CancellationToken ct = default)
            => Task.FromResult<Aidan.Core.Patterns.IResult<string>>(Aidan.Core.Patterns.Result<string>.Success(content));
    }

    private sealed class FakeScriptRepository(Guid scriptId, string content) : IScriptRepository
    {
        public Task<bool> ExistsAsync(Guid id, CancellationToken ct = default)
            => Task.FromResult(id == scriptId);

        public Task<ScriptRecord?> LoadAsync(Guid id, CancellationToken ct = default)
            => Task.FromResult(id == scriptId
                ? new ScriptRecord
                {
                    Id = scriptId,
                    Name = "stored.js",
                    Content = content,
                    Sha256 = new string('a', 64),
                    SizeBytes = content.Length,
                    CreatedAtUtc = DateTimeOffset.UtcNow,
                    UpdatedAtUtc = DateTimeOffset.UtcNow,
                }
                : null);

        public Task SaveAsync(ScriptRecord script, CancellationToken ct = default) => Task.CompletedTask;

        public Task<(IReadOnlyList<Speculum.Api.Scripts.Responses.ScriptListItem> Items, int Total)> ListAsync(
            string query,
            int skip,
            int take,
            CancellationToken ct = default)
            => Task.FromResult<(IReadOnlyList<Speculum.Api.Scripts.Responses.ScriptListItem>, int)>(
                (Array.Empty<Speculum.Api.Scripts.Responses.ScriptListItem>(), 0));

        public Task<bool> DeleteAsync(Guid id, CancellationToken ct = default)
            => Task.FromResult(false);
    }
}
