using Speculum.Api.Motor.Live.Models;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Logging.Abstractions;
using Speculum.Api.Diagnostics.Abstractions;
using Speculum.Api.Motor.Live;
using Speculum.Api.Motor.Mapping;
using Speculum.Api.Config.Runtime;
using Speculum.Api.Config.Store;
using Speculum.Api.BrowserPersistence;
using System.Diagnostics.CodeAnalysis;
using System.Text.Json;
using System.Threading.Channels;

namespace Speculum.Api.Tests;

public sealed class NavigateRejectHubExceptionTests
{
    [Fact]
    public async Task Navigate_outside_allowlist_throws_HubException_not_ArgumentException()
    {
        var session = new AllowlistRejectSession();
        var registry = new SingleSessionRegistry(session);
        var config = new OperationalConfigStore();
        var coordinator = new MotorSessionCoordinator(
            registry,
            config,
            new NoOpBrowserStore(),
            new MotorUrlAdapter(new NavigationStateCodec(new byte[32], encrypt: false)),
            new FixedFactory(session),
            new NullDiagnosticsEventBus(),
            NullLogger<MotorSessionCoordinator>.Instance);

        registry.Register("conn-1", session);

        // Build a target that remaps via NSO to off-allowlist host.
        var codec = new NavigationStateCodec(new byte[32], encrypt: false);
        var nso = codec.Encode(new NavigationStateV1 { H = "evil.example.com" });
        var clientUrl = $"https://speculum.test/?{W7sNavigationQueryParam.Name}={nso}";

        var ex = await Assert.ThrowsAsync<HubException>(
            () => coordinator.NavigateMotorSessionAsync("conn-1", clientUrl, "speculum.test"));
        Assert.Contains("allowlist", ex.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Equal("rejected", session.LastNavigateResult);
    }

    private sealed class AllowlistRejectSession : IMotorSession
    {
        public string? LastNavigateResult { get; private set; }
        public string? PersistedSessionId { get; set; }
        public string SidecarSessionId { get; } = "sidecar";
        public string? CorrelationId { get; set; }
        public string? ClientToken { get; set; }
        public string ConnectionId { get; set; } = "";

        public void MarkPhase(MotorSessionPhase phase) { }
        public MotorSessionDiagnosticsSnapshot GetDiagnosticsSnapshot() => new()
        {
            LastNavigateResult = LastNavigateResult,
        };
        public Task<object> RequestDiagnosticsProbeAsync(
            IReadOnlyList<string> ops, string? evaluateExpression, string? domSelector,
            int? maxProbeResponseBytes = null, CancellationToken ct = default)
            => Task.FromResult<object>(new { });
        public Task StartAsync(CancellationToken ct = default) => Task.CompletedTask;
        public Task StopAsync(CancellationToken ct = default) => Task.CompletedTask;
        public Task CaptureAndPersistAsync(string sessionId, IBrowserSessionStore store, CancellationToken ct = default)
            => Task.CompletedTask;
        public ChannelReader<Frame> GetFrameReader() => Channel.CreateUnbounded<Frame>().Reader;
        public ChannelReader<ConsoleOutput> GetConsoleOutputReader() => Channel.CreateUnbounded<ConsoleOutput>().Reader;
        public ChannelReader<SessionStatus> GetStatusReader() => Channel.CreateUnbounded<SessionStatus>().Reader;
        public Task ConsumeUserInputAsync(ChannelReader<string> channelReader) => Task.CompletedTask;
        public Task ConsumeConsoleInputAsync(ChannelReader<ConsoleInput> channelReader) => Task.CompletedTask;
        public Task NavigateAsync(string url, CancellationToken ct = default)
        {
            // Real MotorSession checks allowlist — emulate reject for off-list host.
            if (url.Contains("evil.example.com", StringComparison.OrdinalIgnoreCase))
            {
                LastNavigateResult = "rejected";
                throw new ArgumentException("URL de navegação fora da allowlist de domínios configurada.");
            }

            LastNavigateResult = "ok";
            return Task.CompletedTask;
        }
        public Task ResizeAsync(int width, int height, CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class SingleSessionRegistry(IMotorSession session) : IMotorSessionRegistry
    {
        public int ActiveCount => 1;
        public int StartingCount => 0;
        public void Register(string connectionId, IMotorSession s) { }
        public IMotorSession? Get(string connectionId) => session;
        public bool TryRemove(string connectionId, [NotNullWhen(true)] out IMotorSession? s)
        { s = session; return true; }
        public bool TryAcquireSlot(int max) => true;
        public void ReleaseSlot() { }
        public void TrackStarting(string connectionId, IMotorSession s) { }
        public bool TryPromoteStarting(string connectionId, IMotorSession s) => true;
        public bool TryCancelStarting(string connectionId, [NotNullWhen(true)] out IMotorSession? s)
        { s = null; return false; }
        public IReadOnlyList<MotorSessionListItem> ListSessions() => [];
        public bool TryFindByPersistedSessionId(string id, [NotNullWhen(true)] out IMotorSession? s, [NotNullWhen(true)] out string? c)
        { s = null; c = null; return false; }
        public bool TryFindBySidecarSessionId(string id, [NotNullWhen(true)] out IMotorSession? s, [NotNullWhen(true)] out string? c)
        { s = null; c = null; return false; }
        public Task StopAllAsync(IBrowserSessionStore store, CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class OperationalConfigStore : ISpeculumConfigStore
    {
        public SpeculumRuntimeConfig Current { get; } = new()
        {
            Forwarding = new ForwardingOptions
            {
                Host = "fixture.test",
                Domains = ["fixture.test", "*.fixture.test"],
            },
            MaxSessions = 4,
            Hosting = new HostingOptions
            {
                Profiles = [new HostingProfileOptions { Domain = "speculum.test" }],
            },
        };
        public bool IsOperational => true;
        public IReadOnlyList<string> MissingRequired => [];
        public Task InitializeAsync(CancellationToken ct = default) => Task.CompletedTask;
        public Task<ConfigUpdateResult> PutSectionAsync(string key, JsonElement body, CancellationToken ct = default)
            => throw new NotSupportedException();
        public Task<JsonElement?> GetSectionAsync(string key, CancellationToken ct = default)
            => throw new NotSupportedException();
        public Task<ConfigUpdateResult> DeleteSectionAsync(string key, CancellationToken ct = default)
            => throw new NotSupportedException();
    }

    private sealed class FixedFactory(IMotorSession session) : IMotorSessionFactory
    {
        public IMotorSession Create(SessionConfigSnapshot snapshot) => session;
    }

    private sealed class NoOpBrowserStore : IBrowserSessionStore
    {
        public Task InitializeAsync(CancellationToken ct = default) => Task.CompletedTask;
        public Task<(string SessionId, string ClientToken)> ResolveOrCreateSessionAsync(
            SessionIdentity identity, CancellationToken ct = default)
            => Task.FromResult(("s", "t"));
        public Task<string> ResolveOrCreateSessionAsync(string clientToken, CancellationToken ct = default)
            => Task.FromResult("s");
        public Task<BrowserStatePayload?> LoadStateAsync(string sessionId, CancellationToken ct = default)
            => Task.FromResult<BrowserStatePayload?>(null);
        public Task SaveStateAsync(string sessionId, BrowserStatePayload state, CancellationToken ct = default)
            => Task.CompletedTask;
        public Task<IReadOnlyList<BrowserSessionMetadata>> ListSessionsAsync(CancellationToken ct = default)
            => Task.FromResult<IReadOnlyList<BrowserSessionMetadata>>([]);
        public Task<BrowserSessionDetail?> GetSessionDetailAsync(string sessionId, CancellationToken ct = default)
            => Task.FromResult<BrowserSessionDetail?>(null);
        public Task<bool> DeleteSessionAsync(string sessionId, CancellationToken ct = default)
            => Task.FromResult(false);
        public Task RefreshPolicyAsync(CancellationToken ct = default) => Task.CompletedTask;
        public Task PurgeExpiredAsync(CancellationToken ct = default) => Task.CompletedTask;
    }
}
