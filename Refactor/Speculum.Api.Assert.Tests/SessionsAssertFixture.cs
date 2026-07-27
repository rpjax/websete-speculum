using System.Net.Http.Json;

namespace Speculum.SessionsAssert.Tests;

[CollectionDefinition(nameof(SessionsAssertCollection), DisableParallelization = true)]
public sealed class SessionsAssertCollection : ICollectionFixture<SessionsAssertFixture>
{
}

public sealed class SessionsAssertFixture
{
    public SessionsAssertHost Host { get; } = new();

    public async Task EnsureBaselineAsync(CancellationToken ct = default)
    {
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
        using var response = await http.PutAsJsonAsync(
            $"{Host.ApiBase}/api/dev/engine-config",
            new
            {
                journal = new Dictionary<string, bool>
                {
                    ["Sessions.InputApplied"] = true,
                    ["Sessions.ResizeApplied"] = true,
                    ["Sessions.ResizeRejected"] = true,
                },
            },
            ct);
        response.EnsureSuccessStatusCode();
    }
}

public abstract class SessionsAssertTestBase : IAsyncLifetime
{
    protected readonly SessionsAssertFixture Fx;

    protected SessionsAssertTestBase(SessionsAssertFixture fixture) => Fx = fixture;

    public Task InitializeAsync() => Fx.EnsureBaselineAsync();

    public Task DisposeAsync() => Task.CompletedTask;
}
