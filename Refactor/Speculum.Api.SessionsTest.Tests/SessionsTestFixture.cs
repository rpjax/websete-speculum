using System.Net.Http.Json;

namespace Speculum.SessionsTest.Tests;

[CollectionDefinition(nameof(SessionsTestCollection), DisableParallelization = true)]
public sealed class SessionsTestCollection : ICollectionFixture<SessionsTestFixture>
{
}

public sealed class SessionsTestFixture
{
    public SessionsTestHost Host { get; } = new();

    public async Task EnsureBaselineAsync(CancellationToken ct = default)
    {
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
        using var response = await http.PutAsJsonAsync(
            $"{Host.ApiBase}/api/configurations/Journal",
            new
            {
                events = new Dictionary<string, bool>
                {
                    ["Sessions.InputApplied"] = true,
                    ["Sessions.InputRejected"] = true,
                    ["Sessions.ResizeApplied"] = true,
                    ["Sessions.ResizeRejected"] = true,
                },
            },
            ct);
        response.EnsureSuccessStatusCode();
    }
}

public abstract class SessionsTestBase : IAsyncLifetime
{
    protected readonly SessionsTestFixture Fx;

    protected SessionsTestBase(SessionsTestFixture fixture) => Fx = fixture;

    public Task InitializeAsync() => Fx.EnsureBaselineAsync();

    public Task DisposeAsync() => Task.CompletedTask;
}
