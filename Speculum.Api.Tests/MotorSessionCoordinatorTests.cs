using System.Diagnostics.CodeAnalysis;
using System.Text.Json;
using System.Threading.Channels;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Logging.Abstractions;
using Speculum.Api.Config.Runtime;
using Speculum.Api.Config.Store;
using Speculum.Api.Diagnostics.Abstractions;
using Speculum.Api.Motor.Diagnostics;
using Speculum.Api.Motor.Live;
using Speculum.Api.Motor.Live.Models;
using Speculum.Api.Motor.Mapping;
using Speculum.Api.BrowserPersistence;

namespace Speculum.Api.Tests;

public sealed class MotorSessionCoordinatorTests
{
    private static MotorSessionCoordinator CreateCoordinator(
        ISpeculumConfigStore configStore,
        IMotorSessionRegistry registry,
        IBrowserSessionStore sessionStore,
        IMotorSessionFactory? sessionFactory = null,
        IDiagnosticsEventBus? diagnostics = null)
    {
        var urlAdapter = new MotorUrlAdapter(new NavigationStateCodec(new byte[32], encrypt: false));
        return new MotorSessionCoordinator(
            registry,
            configStore,
            sessionStore,
            urlAdapter,
            sessionFactory ?? new StubMotorSessionFactory(),
            TestMotorDiagnostics.Factory(diagnostics ?? new NullDiagnosticsEventBus()),
            NullLogger<MotorSessionCoordinator>.Instance);
    }

    [Fact]
    public async Task StartSessionAsync_throws_when_motor_not_operational()
    {
        var coordinator = CreateCoordinator(
            new StubConfigStore(operational: false),
            new StubMotorSessionRegistry(),
            new StubBrowserSessionStore());

        var ex = await Assert.ThrowsAsync<HubException>(() =>
            coordinator.StartSessionAsync("conn-1", "speculum.com", CancellationToken.None,
                "https://speculum.com", 1280, 720, null));

        Assert.Contains("não configurado", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task StartSessionAsync_throws_when_slot_full()
    {
        var coordinator = CreateCoordinator(
            new StubConfigStore(operational: true),
            new StubMotorSessionRegistry(acquireSlot: false),
            new StubBrowserSessionStore());

        var ex = await Assert.ThrowsAsync<HubException>(() =>
            coordinator.StartSessionAsync("conn-1", "speculum.com", CancellationToken.None,
                "https://speculum.com", 1280, 720, null));

        Assert.Contains("Limite de sessões", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task StartSessionAsync_rejects_invalid_client_token_with_hub_exception()
    {
        var coordinator = CreateCoordinator(
            new StubConfigStore(operational: true),
            new StubMotorSessionRegistry(),
            new StubBrowserSessionStore());

        var identity = new SessionIdentity { ClientToken = "tok-not-hex" };
        var ex = await Assert.ThrowsAsync<HubException>(() =>
            coordinator.StartSessionAsync(
                "conn-1", "speculum.com", CancellationToken.None,
                "https://speculum.com", 1280, 720, identity));

        Assert.Contains("clientToken", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task StartSessionAsync_returns_client_token_on_happy_path()
    {
        var coordinator = CreateCoordinator(
            new StubConfigStore(operational: true),
            new StubMotorSessionRegistry(),
            new StubBrowserSessionStore(clientToken: "client-token-abc"));

        var token = await coordinator.StartSessionAsync(
            "conn-1", "speculum.com", CancellationToken.None,
            "https://speculum.com", 1280, 720, null);

        Assert.Equal("client-token-abc", token);
    }

    [Fact]
    public async Task StartSessionAsync_emits_SidecarConnected_only_after_StartAsync()
    {
        var order = new List<string>();
        var session = new TrackingMotorSession
        {
            OnStartAsync = () => order.Add("StartAsync"),
        };
        var bus = new RecordingDiagnosticsEventBus(order);

        var coordinator = CreateCoordinator(
            new StubConfigStore(operational: true),
            new StubMotorSessionRegistry(),
            new StubBrowserSessionStore(clientToken: "tok"),
            sessionFactory: new FixedMotorSessionFactory(session),
            diagnostics: bus);

        await coordinator.StartSessionAsync(
            "conn-1", "speculum.com", CancellationToken.None,
            "https://speculum.com", 1280, 720, null);

        var startIdx = order.IndexOf("StartAsync");
        var connectedIdx = order.IndexOf("Motor.SidecarConnected");
        var startedIdx = order.IndexOf("Motor.SessionStarted");
        Assert.True(startIdx >= 0, "StartAsync should run");
        Assert.True(connectedIdx > startIdx, "SidecarConnected must follow StartAsync");
        Assert.True(startedIdx > connectedIdx, "SessionStarted must follow SidecarConnected");
    }

    [Fact]
    public async Task NavigateMotorSessionAsync_throws_when_session_missing()
    {
        var coordinator = CreateCoordinator(
            new StubConfigStore(operational: true),
            new StubMotorSessionRegistry(),
            new StubBrowserSessionStore());

        var ex = await Assert.ThrowsAsync<HubException>(() =>
            coordinator.NavigateMotorSessionAsync("conn-1", "https://speculum.com/page", "speculum.com"));

        Assert.Contains("Sessão não iniciada", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task NavigateMotorSessionAsync_delegates_to_active_session()
    {
        var registry = new StubMotorSessionRegistry();
        var session = new TrackingMotorSession();
        registry.Register("conn-1", session);

        var coordinator = CreateCoordinator(
            new StubConfigStore(operational: true),
            registry,
            new StubBrowserSessionStore());

        await coordinator.NavigateMotorSessionAsync(
            "conn-1", "https://speculum.com/cars", "speculum.com");

        Assert.NotNull(session.LastNavigateUrl);
        Assert.Contains("example.com", session.LastNavigateUrl, StringComparison.OrdinalIgnoreCase);
    }

    private sealed class RecordingDiagnosticsEventBus(List<string> order) : IDiagnosticsEventBus
    {
        public void Publish(DiagnosticsEvent diagnosticsEvent, bool persist = true)
            => order.Add(diagnosticsEvent.Name);
    }

    private sealed class FixedMotorSessionFactory(IMotorSession session) : IMotorSessionFactory
    {
        public IMotorSession Create(SessionConfigSnapshot snapshot, IMotorEvents events) => session;
    }

    private sealed class TrackingMotorSession : IMotorSession
    {
        public string? LastNavigateUrl { get; private set; }
        public Action? OnStartAsync { get; init; }
        public string? PersistedSessionId { get; set; }
        public string SidecarSessionId { get; init; } = "sidecar-tracking";
        public string? CorrelationId { get; set; }
        public string? ClientToken { get; set; }
        public string ConnectionId { get; set; } = "";

        public void MarkPhase(MotorSessionPhase phase) { }

        public MotorSessionDiagnosticsSnapshot GetDiagnosticsSnapshot() => new();

        public Task<object> RequestDiagnosticsProbeAsync(
            IReadOnlyList<string> ops,
            string? evaluateExpression,
            string? domSelector,
            int? maxProbeResponseBytes = null,
            CancellationToken ct = default)
            => Task.FromResult<object>(new { });

        public Task StartAsync(CancellationToken ct = default)
        {
            OnStartAsync?.Invoke();
            return Task.CompletedTask;
        }
        public Task StopAsync(CancellationToken ct = default) => Task.CompletedTask;
        public Task<BrowserStatePayload?> CaptureAndPersistAsync(string sessionId, IBrowserSessionStore store, CancellationToken ct = default) => Task.FromResult<BrowserStatePayload?>(null);

        public ChannelReader<Frame> GetFrameReader()
            => Channel.CreateUnbounded<Frame>().Reader;

        public ChannelReader<ConsoleOutput> GetConsoleOutputReader()
            => Channel.CreateUnbounded<ConsoleOutput>().Reader;

        public ChannelReader<SessionStatus> GetStatusReader()
            => Channel.CreateUnbounded<SessionStatus>().Reader;

        public Task ConsumeUserInputAsync(ChannelReader<string> channelReader) => Task.CompletedTask;
        public Task ConsumeConsoleInputAsync(ChannelReader<ConsoleInput> channelReader) => Task.CompletedTask;

        public Task NavigateAsync(string url, CancellationToken ct = default)
        {
            LastNavigateUrl = url;
            return Task.CompletedTask;
        }

        public Task ResizeAsync(int width, int height, Speculum.Api.Motor.Live.DeviceProfile? device = null, CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class StubConfigStore : ISpeculumConfigStore
    {
        public StubConfigStore(bool operational)
        {
            IsOperational = operational;
            Current = new SpeculumRuntimeConfig
            {
                Forwarding = new ForwardingOptions
                {
                    Host    = "www.example.com",
                    Domains = ["example.com", "*.example.com"],
                },
                MaxSessions = 2,
                Hosting = new HostingOptions
                {
                    Profiles = [new HostingProfileOptions { Domain = "speculum.com" }],
                },
            };
            MissingRequired = operational ? [] : [ConfigSectionKeys.Forwarding];
        }

        public SpeculumRuntimeConfig Current { get; }
        public bool IsOperational { get; }
        public IReadOnlyList<string> MissingRequired { get; }

        public Task InitializeAsync(CancellationToken ct = default) => Task.CompletedTask;
        public Task<ConfigUpdateResult> PutSectionAsync(string key, JsonElement body, CancellationToken ct = default)
            => throw new NotSupportedException();
        public Task<JsonElement?> GetSectionAsync(string key, CancellationToken ct = default)
            => throw new NotSupportedException();
        public Task<ConfigUpdateResult> DeleteSectionAsync(string key, CancellationToken ct = default)
            => throw new NotSupportedException();
    }

    private sealed class StubMotorSessionRegistry : IMotorSessionRegistry
    {
        private readonly bool _acquireSlot;
        private IMotorSession? _session;

        public StubMotorSessionRegistry(bool acquireSlot = true) => _acquireSlot = acquireSlot;

        public int ActiveCount => _session is null ? 0 : 1;
        public int StartingCount => 0;

        public void Register(string connectionId, IMotorSession session) => _session = session;

        public IMotorSession? Get(string connectionId) => _session;

        public bool TryRemove(string connectionId, [NotNullWhen(true)] out IMotorSession? session)
        {
            session = _session;
            _session = null;
            return session is not null;
        }

        public bool TryAcquireSlot(int max) => _acquireSlot;

        public void ReleaseSlot() { }

        public void TrackStarting(string connectionId, IMotorSession session) => _session = session;

        public bool TryPromoteStarting(string connectionId, IMotorSession session)
        {
            _session = session;
            return true;
        }

        public bool TryCancelStarting(string connectionId, [NotNullWhen(true)] out IMotorSession? session)
        {
            session = _session;
            _session = null;
            return session is not null;
        }

        public IReadOnlyList<MotorSessionListItem> ListSessions() => [];

        public IReadOnlyList<MotorSessionDiagnosticsSnapshot> ListSnapshots() => [];

        public bool TryFindByPersistedSessionId(
            string persistedSessionId,
            [NotNullWhen(true)] out IMotorSession? session,
            [NotNullWhen(true)] out string? connectionId)
        {
            session = null;
            connectionId = null;
            return false;
        }

        public bool TryFindBySidecarSessionId(
            string sidecarSessionId,
            [NotNullWhen(true)] out IMotorSession? session,
            [NotNullWhen(true)] out string? connectionId)
        {
            session = null;
            connectionId = null;
            return false;
        }

        public Task StopAllAsync(
            IBrowserSessionStore store,
            CancellationToken ct = default,
            string? correlationId = null)
            => Task.CompletedTask;
    }

    private sealed class StubBrowserSessionStore : IBrowserSessionStore
    {
        private readonly string _clientToken;

        public StubBrowserSessionStore(string clientToken = "token")
        {
            _clientToken = clientToken;
        }

        public Task InitializeAsync(CancellationToken ct = default) => Task.CompletedTask;

        public Task<string> ResolveOrCreateSessionAsync(string clientToken, CancellationToken ct = default)
            => Task.FromResult("session-id");

        public Task<SessionResolveResult> ResolveOrCreateSessionAsync(
            SessionIdentity identity, CancellationToken ct = default)
            => Task.FromResult(new SessionResolveResult("session-id", _clientToken, Restored: false));

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

    private sealed class StubMotorSessionFactory : IMotorSessionFactory
    {
        public IMotorSession Create(SessionConfigSnapshot snapshot, IMotorEvents events) => new StubMotorSession();
    }

    private sealed class StubMotorSession : IMotorSession
    {
        public string? PersistedSessionId { get; set; }
        public string SidecarSessionId { get; init; } = "sidecar-stub";
        public string? CorrelationId { get; set; }
        public string? ClientToken { get; set; }
        public string ConnectionId { get; set; } = "";

        public void MarkPhase(MotorSessionPhase phase) { }

        public MotorSessionDiagnosticsSnapshot GetDiagnosticsSnapshot() => new();

        public Task<object> RequestDiagnosticsProbeAsync(
            IReadOnlyList<string> ops,
            string? evaluateExpression,
            string? domSelector,
            int? maxProbeResponseBytes = null,
            CancellationToken ct = default)
            => Task.FromResult<object>(new { });

        public Task StartAsync(CancellationToken ct = default) => Task.CompletedTask;
        public Task StopAsync(CancellationToken ct = default) => Task.CompletedTask;
        public Task<BrowserStatePayload?> CaptureAndPersistAsync(string sessionId, IBrowserSessionStore store, CancellationToken ct = default) => Task.FromResult<BrowserStatePayload?>(null);

        public ChannelReader<Frame> GetFrameReader()
            => Channel.CreateUnbounded<Frame>().Reader;

        public ChannelReader<ConsoleOutput> GetConsoleOutputReader()
            => Channel.CreateUnbounded<ConsoleOutput>().Reader;

        public ChannelReader<SessionStatus> GetStatusReader()
            => Channel.CreateUnbounded<SessionStatus>().Reader;

        public Task ConsumeUserInputAsync(ChannelReader<string> channelReader) => Task.CompletedTask;
        public Task ConsumeConsoleInputAsync(ChannelReader<ConsoleInput> channelReader) => Task.CompletedTask;
        public Task NavigateAsync(string url, CancellationToken ct = default) => Task.CompletedTask;
        public Task ResizeAsync(int width, int height, Speculum.Api.Motor.Live.DeviceProfile? device = null, CancellationToken ct = default) => Task.CompletedTask;
    }
}
