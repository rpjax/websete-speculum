using System.Diagnostics.CodeAnalysis;
using System.Text.Json;
using System.Threading.Channels;
using Microsoft.Extensions.Logging.Abstractions;
using Speculum.Api.BrowserPersistence;
using Speculum.Api.Config.Runtime;
using Speculum.Api.Config.Store;
using Speculum.Api.Diagnostics.Abstractions;
using Speculum.Api.Diagnostics.Configuration;
using Speculum.Api.Diagnostics.Pipeline;
using Speculum.Api.Motor.Live;
using Speculum.Api.Motor.Live.Models;
using Speculum.Api.Motor.Mapping;
using Speculum.Api.Motor.Sidecar;

namespace Speculum.Api.Tests;

/// <summary>
/// Act→Assert that SessionResolved / UrlMapped are actually published (not shape-only).
/// </summary>
public sealed class DiagnosticsEmitterPublishTests
{
    private const string ValidToken = "abcdef0123456789abcdef0123456789";

    [Fact]
    public async Task StartSession_publishes_SessionResolved_with_required_payload_fields()
    {
        var bus = new CapturingBus();
        var store = new ConfigurableSessionStore(
            result: new SessionResolveResult("sess-new", ValidToken, Restored: false),
            state: null);
        var coordinator = CreateCoordinator(store, bus);

        await coordinator.StartSessionAsync(
            "conn-1", "speculum.com", CancellationToken.None,
            "https://speculum.com/home", 1280, 720, null);

        var resolved = Assert.Single(bus.Events, e => e.Name == "Motor.SessionResolved");
        Assert.Equal("conn-1", resolved.ConnectionId);
        Assert.Equal("sess-new", resolved.PersistedSessionId);
        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(resolved.Payload));
        var p = doc.RootElement;
        Assert.False(p.GetProperty("clientTokenProvided").GetBoolean());
        Assert.Equal(ValidToken, p.GetProperty("clientTokenEffective").GetString());
        Assert.Equal("sess-new", p.GetProperty("persistedSessionId").GetString());
        Assert.False(p.GetProperty("restored").GetBoolean());
        Assert.False(p.GetProperty("stateLoaded").GetBoolean());
        Assert.Equal(0, p.GetProperty("cookieCount").GetInt32());
        Assert.False(string.IsNullOrWhiteSpace(p.GetProperty("initialUrl").GetString()));
        Assert.Contains(bus.Events, e => e.Name == "Motor.SessionStarted");
    }

    [Fact]
    public async Task StartSession_with_token_and_state_marks_restored_and_counts()
    {
        var bus = new CapturingBus();
        var state = new BrowserStatePayload
        {
            Cookies = [new BrowserCookieState
            {
                Name = "sf", Value = "1", Domain = "example.com", Path = "/",
            }],
            LocalStorage =
            [
                new BrowserLocalStorageState
                {
                    Origin = "https://example.com", Key = "k", Value = "v",
                },
            ],
            History =
            [
                new BrowserHistoryState { Url = "https://example.com/", IndexOrder = 0 },
                new BrowserHistoryState { Url = "https://example.com/b", IndexOrder = 1 },
            ],
        };
        var store = new ConfigurableSessionStore(
            result: new SessionResolveResult("sess-old", ValidToken, Restored: true),
            state: state);
        var coordinator = CreateCoordinator(store, bus);

        await coordinator.StartSessionAsync(
            "conn-2", "speculum.com", CancellationToken.None,
            "https://speculum.com/", 800, 600,
            new SessionIdentity { ClientToken = ValidToken, CorrelationId = "act1" });

        var resolved = Assert.Single(bus.Events, e => e.Name == "Motor.SessionResolved");
        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(resolved.Payload));
        var p = doc.RootElement;
        Assert.True(p.GetProperty("clientTokenProvided").GetBoolean());
        Assert.True(p.GetProperty("restored").GetBoolean());
        Assert.True(p.GetProperty("stateLoaded").GetBoolean());
        Assert.Equal(1, p.GetProperty("cookieCount").GetInt32());
        Assert.Equal(1, p.GetProperty("localStorageCount").GetInt32());
        Assert.Equal(2, p.GetProperty("historyCount").GetInt32());
        Assert.Equal("act1", resolved.CorrelationId);
    }

    [Fact]
    public void UrlMapped_publishes_once_per_distinct_clientUrl()
    {
        var bus = new CapturingBus();
        var session = CreateMotorSession(bus, motorHost: "speculum.com");
        session.ConnectionId = "conn-u";
        session.CorrelationId = "c1";
        session.PersistedSessionId = "ps1";

        var first = session.MapTargetUrlForClient("https://www.example.com/nav/a");
        var again = session.MapTargetUrlForClient("https://www.example.com/nav/a");
        var second = session.MapTargetUrlForClient("https://www.example.com/nav/b");

        Assert.Contains("_w7s_nso", first, StringComparison.Ordinal);
        Assert.Equal(first, again);
        Assert.NotEqual(first, second);

        var mapped = bus.Events.Where(e => e.Name == "Motor.UrlMapped").ToList();
        Assert.Equal(2, mapped.Count);
        using var p0 = JsonDocument.Parse(JsonSerializer.Serialize(mapped[0].Payload));
        using var p1 = JsonDocument.Parse(JsonSerializer.Serialize(mapped[1].Payload));
        Assert.Contains("/nav/a", p0.RootElement.GetProperty("clientUrl").GetString()!, StringComparison.Ordinal);
        Assert.Contains("/nav/b", p1.RootElement.GetProperty("clientUrl").GetString()!, StringComparison.Ordinal);
        Assert.Equal("https://www.example.com/nav/b", p1.RootElement.GetProperty("targetUrl").GetString());
    }

    [Fact]
    public void EventBus_Off_drops_SessionResolved_and_UrlMapped()
    {
        var runtime = new DiagnosticsRuntime();
        runtime.ApplyOptions(new DiagnosticsOptions { Enabled = false });
        var sink = new RecordingSink();
        var ring = new SessionEventRing();
        var bus = new DiagnosticsEventBus(
            runtime, [sink], ring, NullLogger<DiagnosticsEventBus>.Instance);

        bus.Publish(new DiagnosticsEvent
        {
            Domain = DiagnosticsDomain.MotorLive,
            Name = "Motor.SessionResolved",
            ConnectionId = "c",
        });
        bus.Publish(new DiagnosticsEvent
        {
            Domain = DiagnosticsDomain.MotorLive,
            Name = "Motor.UrlMapped",
            ConnectionId = "c",
        });

        Assert.Empty(sink.Events);
        Assert.Empty(ring.GetSince("c", null, null));
    }

    [Fact]
    public void EventBus_Degraded_still_accepts_catalog_SessionResolved_and_UrlMapped()
    {
        var runtime = new DiagnosticsRuntime();
        runtime.ApplyOptions(DiagnosticsSeedProfiles.Development());
        runtime.SetDegraded(true);
        Assert.False(runtime.IsEnabled(DiagnosticsDomain.MotorLive, DiagnosticsLevel.Events));

        var sink = new RecordingSink();
        var ring = new SessionEventRing();
        var bus = new DiagnosticsEventBus(
            runtime, [sink], ring, NullLogger<DiagnosticsEventBus>.Instance);

        bus.Publish(new DiagnosticsEvent
        {
            Domain = DiagnosticsDomain.MotorLive,
            Name = "Motor.SessionResolved",
            ConnectionId = "c",
        });
        bus.Publish(new DiagnosticsEvent
        {
            Domain = DiagnosticsDomain.MotorLive,
            Name = "Motor.UrlMapped",
            ConnectionId = "c",
            Payload = new { targetUrl = "https://t/", clientUrl = "https://c/?_w7s_nso=x" },
        });

        Assert.Contains(sink.Events, e => e.Name == "Motor.SessionResolved");
        Assert.Contains(sink.Events, e => e.Name == "Motor.UrlMapped");
        Assert.Equal(2, ring.GetSince("c", null, "Motor.").Count);
    }

    private static MotorSessionCoordinator CreateCoordinator(
        IBrowserSessionStore store,
        IDiagnosticsEventBus bus)
    {
        var urlAdapter = new MotorUrlAdapter(new NavigationStateCodec(new byte[32], encrypt: false));
        return new MotorSessionCoordinator(
            new StubRegistry(),
            new StubConfig(),
            store,
            urlAdapter,
            new StubFactory(),
            bus,
            NullLogger<MotorSessionCoordinator>.Instance);
    }

    private static MotorSession CreateMotorSession(IDiagnosticsEventBus bus, string motorHost)
    {
        var codec = new NavigationStateCodec(new byte[32], encrypt: false);
        var adapter = new MotorUrlAdapter(codec);
        var forwarding = new ForwardingOptions
        {
            Host = "www.example.com",
            Domains = ["example.com", "*.example.com"],
        };
        var profile = new HostingProfileOptions
        {
            Domain = "speculum.com",
            SubdomainMirroringEnabled = false,
        };
        var snapshot = new SessionConfigSnapshot
        {
            InitialUrl = "https://www.example.com/",
            Width = 1280,
            Height = 720,
            Forwarding = forwarding,
            HostingProfile = profile,
            MotorRequestHost = motorHost,
            AllowedNavigationDomains = forwarding.Domains,
        };
        var runtime = new DiagnosticsRuntime();
        runtime.ApplyOptions(DiagnosticsSeedProfiles.Development());
        return new MotorSession(
            new SidecarBrowserClientOptions { SidecarBaseUrl = "ws://127.0.0.1:9" },
            snapshot,
            adapter,
            new ThrowingSidecarFactory(),
            bus,
            runtime,
            NullLogger.Instance);
    }

    private sealed class CapturingBus : IDiagnosticsEventBus
    {
        public List<DiagnosticsEvent> Events { get; } = [];
        public void Publish(DiagnosticsEvent diagnosticsEvent, bool persist = true)
            => Events.Add(diagnosticsEvent);
    }

    private sealed class RecordingSink : IDiagnosticsSink
    {
        public List<DiagnosticsEvent> Events { get; } = [];
        public ValueTask WriteAsync(DiagnosticsEvent diagnosticsEvent, CancellationToken ct = default)
        {
            Events.Add(diagnosticsEvent);
            return ValueTask.CompletedTask;
        }
    }

    private sealed class ConfigurableSessionStore(
        SessionResolveResult result,
        BrowserStatePayload? state) : IBrowserSessionStore
    {
        public Task InitializeAsync(CancellationToken ct = default) => Task.CompletedTask;
        public Task<string> ResolveOrCreateSessionAsync(string clientToken, CancellationToken ct = default)
            => Task.FromResult(result.SessionId);
        public Task<SessionResolveResult> ResolveOrCreateSessionAsync(
            SessionIdentity identity, CancellationToken ct = default)
            => Task.FromResult(result);
        public Task<BrowserStatePayload?> LoadStateAsync(string sessionId, CancellationToken ct = default)
            => Task.FromResult(state);
        public Task SaveStateAsync(string sessionId, BrowserStatePayload s, CancellationToken ct = default)
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

    private sealed class StubConfig : ISpeculumConfigStore
    {
        public SpeculumRuntimeConfig Current { get; } = new()
        {
            Forwarding = new ForwardingOptions
            {
                Host = "www.example.com",
                Domains = ["example.com", "*.example.com"],
            },
            MaxSessions = 4,
            Hosting = new HostingOptions
            {
                Profiles =
                [
                    new HostingProfileOptions
                    {
                        Domain = "speculum.com",
                        SubdomainMirroringEnabled = false,
                    },
                ],
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

    private sealed class StubRegistry : IMotorSessionRegistry
    {
        private IMotorSession? _session;
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
        public bool TryAcquireSlot(int max) => true;
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
        public bool TryFindByPersistedSessionId(
            string id,
            [NotNullWhen(true)] out IMotorSession? session,
            [NotNullWhen(true)] out string? connectionId)
        {
            session = null; connectionId = null; return false;
        }
        public bool TryFindBySidecarSessionId(
            string id,
            [NotNullWhen(true)] out IMotorSession? session,
            [NotNullWhen(true)] out string? connectionId)
        {
            session = null; connectionId = null; return false;
        }
        public Task StopAllAsync(IBrowserSessionStore store, CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class StubFactory : IMotorSessionFactory
    {
        public IMotorSession Create(SessionConfigSnapshot snapshot) => new StubSession();
    }

    private sealed class StubSession : IMotorSession
    {
        public string? PersistedSessionId { get; set; }
        public string SidecarSessionId { get; init; } = "sc";
        public string? CorrelationId { get; set; }
        public string? ClientToken { get; set; }
        public string ConnectionId { get; set; } = "";
        public void MarkPhase(MotorSessionPhase phase) { }
        public MotorSessionDiagnosticsSnapshot GetDiagnosticsSnapshot() => new();
        public Task<object> RequestDiagnosticsProbeAsync(
            IReadOnlyList<string> ops, string? evaluateExpression, string? domSelector,
            int? maxProbeResponseBytes = null, CancellationToken ct = default)
            => Task.FromResult<object>(new { });
        public Task StartAsync(CancellationToken ct = default) => Task.CompletedTask;
        public Task StopAsync(CancellationToken ct = default) => Task.CompletedTask;
        public Task CaptureAndPersistAsync(string sessionId, IBrowserSessionStore store, CancellationToken ct = default)
            => Task.CompletedTask;
        public ChannelReader<Frame> GetFrameReader() => Channel.CreateUnbounded<Frame>().Reader;
        public ChannelReader<ConsoleOutput> GetConsoleOutputReader()
            => Channel.CreateUnbounded<ConsoleOutput>().Reader;
        public ChannelReader<SessionStatus> GetStatusReader()
            => Channel.CreateUnbounded<SessionStatus>().Reader;
        public Task ConsumeUserInputAsync(ChannelReader<string> channelReader) => Task.CompletedTask;
        public Task ConsumeConsoleInputAsync(ChannelReader<ConsoleInput> channelReader) => Task.CompletedTask;
        public Task NavigateAsync(string url, CancellationToken ct = default) => Task.CompletedTask;
        public Task ResizeAsync(int width, int height, CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class ThrowingSidecarFactory : ISidecarClientFactory
    {
        public ISidecarClient Create(string sessionId)
            => throw new InvalidOperationException("sidecar not used in UrlMapped unit test");
    }
}
