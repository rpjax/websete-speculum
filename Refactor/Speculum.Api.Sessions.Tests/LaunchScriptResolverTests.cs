using Microsoft.Extensions.DependencyInjection;
using Speculum.Api.Configurations.Models.Patterns;
using Speculum.Api.Configurations.Models.Scripting;
using Speculum.Api.Scripts.Services.Contracts;
using Speculum.Api.Scripts.Storage;
using Speculum.Api.Sessions.Services;

namespace Speculum.Api.Sessions.Tests;

public sealed class LaunchScriptResolverTests
{
    [Fact]
    public async Task ResolveAsync_StoredLiteral_RemoteUrlOnly_NoFetch()
    {
        var storedId = Guid.NewGuid();
        var services = new ServiceCollection();
        services.AddScoped<IScriptRepository>(_ => new FakeScriptRepository(storedId, "console.log('stored');"));
        var provider = services.BuildServiceProvider();
        var resolver = new LaunchScriptResolver(provider.GetRequiredService<IServiceScopeFactory>());

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
                            Domain = new DomainPattern { Scope = PatternScope.Any },
                            Path = new PathPattern { Scope = PatternScope.Any },
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

        Assert.True(resolved.IsSuccess, string.Join("; ", resolved.Errors));
        Assert.Equal(2, resolved.Value.Count);
        Assert.Equal("console.log('stored');", resolved.Value[0].Content);
        Assert.Null(resolved.Value[0].RemoteUrl);
        Assert.Equal("", resolved.Value[1].Content);
        Assert.Equal("https://cdn.example.com/script.js", resolved.Value[1].RemoteUrl);
        Assert.Equal("BodyBottom", resolved.Value[1].Position);
    }

    [Fact]
    public async Task ResolveAsync_StoredMissing_FailsMotor()
    {
        var services = new ServiceCollection();
        services.AddScoped<IScriptRepository>(_ => new FakeScriptRepository(Guid.NewGuid(), "x"));
        var provider = services.BuildServiceProvider();
        var resolver = new LaunchScriptResolver(provider.GetRequiredService<IServiceScopeFactory>());

        var config = new ScriptingConfiguration
        {
            Injections =
            [
                new ScriptInjectionConfiguration
                {
                    Source = new ScriptSourceConfiguration
                    {
                        SourceType = ScriptSourceType.Stored,
                        StoredScriptId = Guid.NewGuid(),
                    },
                    Position = ScriptInjectionPosition.BodyEnd,
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

        var resolved = await resolver.ResolveAsync(config);
        Assert.True(resolved.IsFailure);
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
