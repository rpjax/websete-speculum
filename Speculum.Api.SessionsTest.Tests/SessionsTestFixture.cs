using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;

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
            $"{Host.ApiBase}/api/configurations/Telemetry",
            new
            {
                events = BaselineTelemetryEvents,
            },
            ct);
        response.EnsureSuccessStatusCode();
    }

    /// <summary>
    /// Opt-in Telemetry sampling for tests that assert <c>Telemetry.Sampling.SampleCollected</c>.
    /// Re-includes baseline event facts (Telemetry section PUT replaces the whole document).
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
                events = BaselineTelemetryEvents,
            },
            ct);
        response.EnsureSuccessStatusCode();
    }

    /// <summary>
    /// GET Sessions → patch <c>mirrorMode</c> → PUT full body.
    /// Required for legacy VideoStreaming C* rows after product default flipped to PageProjection.
    /// </summary>
    public async Task EnsureSessionsMirrorModeAsync(
        string mirrorMode,
        CancellationToken ct = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(mirrorMode);
        var mode = mirrorMode.Trim();
        if (!string.Equals(mode, "pageProjection", StringComparison.Ordinal)
            && !string.Equals(mode, "videoStreaming", StringComparison.Ordinal))
        {
            throw new ArgumentException(
                "mirrorMode must be pageProjection or videoStreaming",
                nameof(mirrorMode));
        }

        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
        using var get = await http.GetAsync($"{Host.ApiBase}/api/configurations/Sessions", ct);
        get.EnsureSuccessStatusCode();
        var json = await get.Content.ReadAsStringAsync(ct);
        var node = JsonNode.Parse(string.IsNullOrWhiteSpace(json) ? "{}" : json)
            ?? new JsonObject();
        node["mirrorMode"] = mode;

        using var put = await http.PutAsync(
            $"{Host.ApiBase}/api/configurations/Sessions",
            new StringContent(node.ToJsonString(), System.Text.Encoding.UTF8, "application/json"),
            ct);
        put.EnsureSuccessStatusCode();
    }

    private static Dictionary<string, bool> BaselineTelemetryEvents { get; } = new()
    {
        ["Telemetry.Sessions.VideoStreamingInput.Applied"] = true,
        ["Telemetry.Sessions.VideoStreamingInput.Rejected"] = true,
        ["Telemetry.Sessions.Resize.Applied"] = true,
        ["Telemetry.Sessions.Resize.Rejected"] = true,
        ["Telemetry.Sessions.PageProjection.Frame.ResyncRequested"] = true,
        ["Telemetry.Sessions.PageProjection.Frame.FrameReceived"] = true,
    };
}

public abstract class SessionsTestBase : IAsyncLifetime
{
    protected readonly SessionsTestFixture Fx;

    protected SessionsTestBase(SessionsTestFixture fixture) => Fx = fixture;

    public virtual Task InitializeAsync() => Fx.EnsureBaselineAsync();

    public virtual Task DisposeAsync() => Task.CompletedTask;
}
