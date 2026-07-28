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

    /// <summary>
    /// Opt-in Telemetry for tests that assert <c>Telemetry.SampleCollected</c>.
    /// Apply maps <c>IsEnabled</c> onto the Journal catalog (Telemetry-owned facts).
    /// </summary>
    public async Task EnsureTelemetryEnabledAsync(
        bool includePerSession = false,
        CancellationToken ct = default)
    {
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
        using var response = await http.PutAsJsonAsync(
            $"{Host.ApiBase}/api/configurations/Telemetry",
            new
            {
                isEnabled = true,
                intervalSeconds = 15,
                host = new { isEnabled = true },
                apiProcess = new { isEnabled = true },
                sessions = new
                {
                    isEnabled = true,
                    includePerSession,
                    includeSessionIds = true,
                },
                sidecar = new { isEnabled = true },
                profiles = new { isEnabled = true },
                journal = new { isEnabled = true },
                docker = new { isEnabled = false },
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
