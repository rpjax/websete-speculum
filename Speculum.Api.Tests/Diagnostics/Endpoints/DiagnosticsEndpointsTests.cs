using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using Microsoft.Extensions.DependencyInjection;
using Speculum.Api.BrowserPersistence;
using Speculum.Api.Config.Runtime;
using Speculum.Api.Config.Store;
using Speculum.Api.Diagnostics.Abstractions;
using Speculum.Api.Diagnostics.Configuration;
using Speculum.Api.Motor.Live;
using Speculum.Api.Motor.Live.Models;

namespace Speculum.Api.Tests;

[Collection(nameof(SpeculumIntegrationTestCollection))]
public sealed class DiagnosticsEndpointsTests : IDisposable
{
    private readonly SpeculumWebApplicationFactory _factory;
    private readonly HttpClient _client;

    public DiagnosticsEndpointsTests(SpeculumWebApplicationFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();
    }

    public void Dispose() => _client.Dispose();

    [Fact]
    public async Task Runtime_is_available_when_unconfigured()
    {
        await AuthenticateAsync();
        var response = await _client.GetAsync("/api/admin/diagnostics/v1/runtime");
        response.EnsureSuccessStatusCode();
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(DiagnosticsSchema.Version, doc.RootElement.GetProperty("diagnosticsSchemaVersion").GetInt32());
        Assert.True(doc.RootElement.TryGetProperty("redaction", out _));
    }

    [Fact]
    public async Task Catalog_lists_stable_events()
    {
        await AuthenticateAsync();
        var response = await _client.GetAsync("/api/admin/diagnostics/v1/catalog/events");
        response.EnsureSuccessStatusCode();
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var events = doc.RootElement.GetProperty("events").EnumerateArray().Select(e => e.GetString()).ToHashSet();
        Assert.Contains("Motor.SessionStarted", events);
        Assert.Contains("Diagnostics.StorageOverflow", events);
        Assert.Contains("Motor.DrainStarted", events);
    }

    [Fact]
    public async Task Absent_session_returns_session_gone()
    {
        await AuthenticateAsync();
        var get = await _client.GetAsync("/api/admin/diagnostics/v1/sessions/no-such-conn");
        Assert.Equal(HttpStatusCode.NotFound, get.StatusCode);
        using var getDoc = JsonDocument.Parse(await get.Content.ReadAsStringAsync());
        Assert.Equal("session_gone", getDoc.RootElement.GetProperty("errorCode").GetString());

        var post = await _client.PostAsync(
            "/api/admin/diagnostics/v1/sessions/no-such-conn/browser",
            new StringContent("""{"ops":["process"]}""", Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.NotFound, post.StatusCode);
        using var postDoc = JsonDocument.Parse(await post.Content.ReadAsStringAsync());
        Assert.Equal("session_gone", postDoc.RootElement.GetProperty("errorCode").GetString());
    }

    [Fact]
    public async Task Elevate_writes_audit_event_payload()
    {
        await AuthenticateAsync();
        var put = await _client.PutAsync(
            "/api/admin/diagnostics/v1/elevate",
            new StringContent("""{"browserQueryFloor":"BrowserQuery","minutes":5}""", Encoding.UTF8, "application/json"));
        put.EnsureSuccessStatusCode();

        var events = await _client.GetAsync("/api/admin/diagnostics/v1/events?namePrefix=Diagnostics.Elevate");
        events.EnsureSuccessStatusCode();
        using var doc = JsonDocument.Parse(await events.Content.ReadAsStringAsync());
        var names = doc.RootElement.EnumerateArray().Select(e => e.GetProperty("name").GetString()).ToArray();
        Assert.Contains("Diagnostics.ElevateStarted", names);

        var del = await _client.DeleteAsync("/api/admin/diagnostics/v1/elevate");
        del.EnsureSuccessStatusCode();

        var events2 = await _client.GetAsync("/api/admin/diagnostics/v1/events?namePrefix=Diagnostics.Elevate");
        events2.EnsureSuccessStatusCode();
        using var doc2 = JsonDocument.Parse(await events2.Content.ReadAsStringAsync());
        var names2 = doc2.RootElement.EnumerateArray().Select(e => e.GetProperty("name").GetString()).ToArray();
        Assert.Contains("Diagnostics.ElevateExpired", names2);
    }

    [Fact]
    public async Task Recover_clears_degraded_and_audits()
    {
        await AuthenticateAsync();
        var runtime = _factory.Services.GetRequiredService<IDiagnosticsRuntime>();
        runtime.SetDegraded(true);
        Assert.True(runtime.IsDegraded);

        var recover = await _client.PostAsync("/api/admin/diagnostics/v1/recover", content: null);
        recover.EnsureSuccessStatusCode();
        using var body = JsonDocument.Parse(await recover.Content.ReadAsStringAsync());
        Assert.False(body.RootElement.GetProperty("degraded").GetBoolean());
        Assert.True(body.RootElement.GetProperty("recovered").GetBoolean());
        Assert.False(runtime.IsDegraded);

        var events = await _client.GetAsync("/api/admin/diagnostics/v1/events?namePrefix=Diagnostics.Recovered");
        events.EnsureSuccessStatusCode();
        using var doc = JsonDocument.Parse(await events.Content.ReadAsStringAsync());
        Assert.Contains(
            doc.RootElement.EnumerateArray(),
            e => e.GetProperty("name").GetString() == "Diagnostics.Recovered");
    }

    [Fact]
    public async Task Host_returns_data_envelope_with_redaction()
    {
        await AuthenticateAsync();
        var response = await _client.GetAsync("/api/admin/diagnostics/v1/host");
        response.EnsureSuccessStatusCode();
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.True(doc.RootElement.TryGetProperty("data", out _));
        Assert.True(doc.RootElement.TryGetProperty("redaction", out _));
    }

    [Fact]
    public async Task BrowserQuery_off_rejects_cookie_probe_with_live_session()
    {
        await AuthenticateAsync();
        await PutDiagnosticsAsync("""
        {
          "enabled": true,
          "defaultLevel": "Events",
          "domains": {
            "motorLive": "Events",
            "sidecarBrowser": "Metrics",
            "hostResources": "Metrics",
            "browserQuery": "Off",
            "persistedSessions": "StateSnapshots"
          },
          "probe": { "maxConcurrentProbesPerSession": 2, "diagTimeoutMs": 5000, "maxProbeResponseBytes": 524288 }
        }
        """);

        const string connectionId = "probe-gate-conn";
        var registry = _factory.Services.GetRequiredService<IMotorSessionRegistry>();
        registry.Register(connectionId, new InstantProbeSession());

        try
        {
            var post = await _client.PostAsync(
                $"/api/admin/diagnostics/v1/sessions/{connectionId}/browser",
                new StringContent("""{"ops":["cookies"]}""", Encoding.UTF8, "application/json"));
            Assert.Equal(HttpStatusCode.Forbidden, post.StatusCode);
            using var doc = JsonDocument.Parse(await post.Content.ReadAsStringAsync());
            Assert.Equal("probe_level_insufficient", doc.RootElement.GetProperty("errorCode").GetString());
        }
        finally
        {
            registry.TryRemove(connectionId, out _);
            await RestoreDevelopmentDiagnosticsAsync();
        }
    }

    [Fact]
    public async Task Concurrent_probes_return_probe_busy()
    {
        await AuthenticateAsync();
        await PutDiagnosticsAsync("""
        {
          "enabled": true,
          "defaultLevel": "Events",
          "domains": {
            "motorLive": "Events",
            "sidecarBrowser": "Metrics",
            "hostResources": "Metrics",
            "browserQuery": "Off",
            "persistedSessions": "StateSnapshots"
          },
          "probe": { "maxConcurrentProbesPerSession": 1, "diagTimeoutMs": 15000, "maxProbeResponseBytes": 524288 }
        }
        """);

        const string connectionId = "probe-busy-conn";
        var gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var registry = _factory.Services.GetRequiredService<IMotorSessionRegistry>();
        registry.Register(connectionId, new BlockingProbeSession(entered, gate.Task));

        try
        {
            var first = _client.PostAsync(
                $"/api/admin/diagnostics/v1/sessions/{connectionId}/browser",
                new StringContent("""{"ops":["process"]}""", Encoding.UTF8, "application/json"));

            await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));

            var second = await _client.PostAsync(
                $"/api/admin/diagnostics/v1/sessions/{connectionId}/browser",
                new StringContent("""{"ops":["process"]}""", Encoding.UTF8, "application/json"));
            Assert.Equal(HttpStatusCode.TooManyRequests, second.StatusCode);
            using var doc = JsonDocument.Parse(await second.Content.ReadAsStringAsync());
            Assert.Equal("probe_busy", doc.RootElement.GetProperty("errorCode").GetString());

            gate.TrySetResult();
            var firstResponse = await first;
            firstResponse.EnsureSuccessStatusCode();
        }
        finally
        {
            gate.TrySetResult();
            registry.TryRemove(connectionId, out _);
            await RestoreDevelopmentDiagnosticsAsync();
        }
    }

    private async Task PutDiagnosticsAsync(string json)
    {
        var put = await _client.PutAsync(
            $"/api/admin/config/{ConfigSectionKeys.Diagnostics}",
            new StringContent(json, Encoding.UTF8, "application/json"));
        put.EnsureSuccessStatusCode();
    }

    private async Task RestoreDevelopmentDiagnosticsAsync()
    {
        var json = JsonSerializer.Serialize(DiagnosticsSeedProfiles.Development());
        await PutDiagnosticsAsync(json);
    }

    private async Task AuthenticateAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var store = scope.ServiceProvider.GetRequiredService<ISpeculumConfigStore>();
        var key = store.Current.AdminApiKey;
        Assert.False(string.IsNullOrWhiteSpace(key));
        _client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", key);
        await Task.CompletedTask;
    }

    private sealed class InstantProbeSession : IMotorSession
    {
        public string? PersistedSessionId { get; set; }
        public string SidecarSessionId { get; } = "sidecar-instant";
        public string? CorrelationId { get; set; }
        public string? ClientToken { get; set; }
        public string ConnectionId { get; set; } = "";

        public void MarkPhase(MotorSessionPhase phase) { }
        public MotorSessionDiagnosticsSnapshot GetDiagnosticsSnapshot() => new();
        public Task<object> RequestDiagnosticsProbeAsync(
            IReadOnlyList<string> ops, string? evaluateExpression, string? domSelector,
            int? maxProbeResponseBytes = null, CancellationToken ct = default)
            => Task.FromResult<object>(new { process = new { ok = true } });
        public Task StartAsync(CancellationToken ct = default) => Task.CompletedTask;
        public Task StopAsync(CancellationToken ct = default) => Task.CompletedTask;
        public Task<BrowserStatePayload?> CaptureAndPersistAsync(string sessionId, IBrowserSessionStore store, CancellationToken ct = default) => Task.FromResult<BrowserStatePayload?>(null);
        public ChannelReader<Frame> GetFrameReader() => Channel.CreateUnbounded<Frame>().Reader;
        public ChannelReader<ConsoleOutput> GetConsoleOutputReader() => Channel.CreateUnbounded<ConsoleOutput>().Reader;
        public ChannelReader<SessionStatus> GetStatusReader() => Channel.CreateUnbounded<SessionStatus>().Reader;
        public Task ConsumeUserInputAsync(ChannelReader<string> channelReader) => Task.CompletedTask;
        public Task ConsumeConsoleInputAsync(ChannelReader<ConsoleInput> channelReader) => Task.CompletedTask;
        public Task NavigateAsync(string url, CancellationToken ct = default) => Task.CompletedTask;
        public Task ResizeAsync(int width, int height, CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class BlockingProbeSession(TaskCompletionSource entered, Task release) : IMotorSession
    {
        public string? PersistedSessionId { get; set; }
        public string SidecarSessionId { get; } = "sidecar-blocking";
        public string? CorrelationId { get; set; }
        public string? ClientToken { get; set; }
        public string ConnectionId { get; set; } = "";

        public void MarkPhase(MotorSessionPhase phase) { }
        public MotorSessionDiagnosticsSnapshot GetDiagnosticsSnapshot() => new();
        public async Task<object> RequestDiagnosticsProbeAsync(
            IReadOnlyList<string> ops, string? evaluateExpression, string? domSelector,
            int? maxProbeResponseBytes = null, CancellationToken ct = default)
        {
            entered.TrySetResult();
            await release.WaitAsync(ct);
            return new { process = new { ok = true } };
        }
        public Task StartAsync(CancellationToken ct = default) => Task.CompletedTask;
        public Task StopAsync(CancellationToken ct = default) => Task.CompletedTask;
        public Task<BrowserStatePayload?> CaptureAndPersistAsync(string sessionId, IBrowserSessionStore store, CancellationToken ct = default) => Task.FromResult<BrowserStatePayload?>(null);
        public ChannelReader<Frame> GetFrameReader() => Channel.CreateUnbounded<Frame>().Reader;
        public ChannelReader<ConsoleOutput> GetConsoleOutputReader() => Channel.CreateUnbounded<ConsoleOutput>().Reader;
        public ChannelReader<SessionStatus> GetStatusReader() => Channel.CreateUnbounded<SessionStatus>().Reader;
        public Task ConsumeUserInputAsync(ChannelReader<string> channelReader) => Task.CompletedTask;
        public Task ConsumeConsoleInputAsync(ChannelReader<ConsoleInput> channelReader) => Task.CompletedTask;
        public Task NavigateAsync(string url, CancellationToken ct = default) => Task.CompletedTask;
        public Task ResizeAsync(int width, int height, CancellationToken ct = default) => Task.CompletedTask;
    }
}
