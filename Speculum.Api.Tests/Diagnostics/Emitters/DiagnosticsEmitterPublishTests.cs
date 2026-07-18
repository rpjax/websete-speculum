using System.Diagnostics.CodeAnalysis;
using System.Text.Json;
using System.Threading.Channels;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Logging.Abstractions;
using Speculum.Api.BrowserPersistence;
using Speculum.Api.Config.Runtime;
using Speculum.Api.Config.Store;
using Speculum.Api.Diagnostics.Abstractions;
using Speculum.Api.Diagnostics.Configuration;
using Speculum.Api.Diagnostics.Emitters;
using Speculum.Api.Diagnostics.Pipeline;
using Speculum.Api.Motor.Diagnostics;
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

    // Matches the production wire: the sink serializes payloads with the camelCase policy.
    private static readonly JsonSerializerOptions CamelCase = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

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
        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(resolved.Payload, CamelCase));
        var p = doc.RootElement;
        Assert.False(p.GetProperty("clientTokenProvided").GetBoolean());
        Assert.Equal(ValidToken, p.GetProperty("clientTokenEffective").GetString());
        // persistedSessionId lives on the envelope now, not duplicated in the payload.
        Assert.False(p.TryGetProperty("persistedSessionId", out _));
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
        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(resolved.Payload, CamelCase));
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
        using var p0 = JsonDocument.Parse(JsonSerializer.Serialize(mapped[0].Payload, CamelCase));
        using var p1 = JsonDocument.Parse(JsonSerializer.Serialize(mapped[1].Payload, CamelCase));
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
        var bus = BuildBus(runtime, sink, ring);

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
        Assert.False(runtime.IsCapabilityEnabled(DiagnosticsDomain.MotorLive, DiagnosticsCapability.Event));

        var sink = new RecordingSink();
        var ring = new SessionEventRing();
        var bus = BuildBus(runtime, sink, ring);

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

    [Fact]
    public async Task StartSession_failed_sidecar_publishes_SessionStartFailed_payload()
    {
        var bus = new CapturingBus();
        var store = new ConfigurableSessionStore(
            result: new SessionResolveResult("sess-fail", ValidToken, Restored: true),
            state: new BrowserStatePayload
            {
                Cookies = [new BrowserCookieState { Name = "a", Value = "1", Domain = "example.com", Path = "/" }],
            });
        var coordinator = CreateCoordinator(
            store, bus, new ThrowingSessionFactory(
                new SidecarProtocolException("cookie_import_invalid", "Network.setCookies: Invalid parameters")));

        var ex = await Assert.ThrowsAsync<HubException>(() => coordinator.StartSessionAsync(
            "conn-fail", "speculum.com", CancellationToken.None,
            "https://speculum.com/", 800, 600,
            new SessionIdentity { ClientToken = ValidToken }));

        Assert.Contains("Falha", ex.Message, StringComparison.OrdinalIgnoreCase);
        var failed = Assert.Single(bus.Events, e => e.Name == "Motor.SessionStartFailed");
        Assert.Equal("sess-fail", failed.PersistedSessionId);
        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(failed.Payload, CamelCase));
        var p = doc.RootElement;
        Assert.Equal("cookie_import_invalid", p.GetProperty("errorCode").GetString());
        Assert.Equal("import_browser_state", p.GetProperty("phase").GetString());
        Assert.False(string.IsNullOrWhiteSpace(p.GetProperty("message").GetString()));
        // Envelope carries identity; payload is dedup'd.
        Assert.False(p.TryGetProperty("persistedSessionId", out _));
        Assert.True(p.GetProperty("restored").GetBoolean());
        Assert.True(p.GetProperty("stateLoaded").GetBoolean());
        Assert.Equal(1, p.GetProperty("cookieCount").GetInt32());
    }

    [Fact]
    public async Task Disconnect_export_failure_publishes_StateExportFailed_payload()
    {
        var bus = new CapturingBus();
        var registry = new StubRegistry();
        var session = new ExportFailingSession
        {
            ConnectionId = "conn-x",
            PersistedSessionId = "sess-x",
            CorrelationId = "c-x",
        };
        registry.Register("conn-x", session);
        var coordinator = new MotorSessionCoordinator(
            registry,
            new StubConfig(),
            new ConfigurableSessionStore(
                new SessionResolveResult("sess-x", ValidToken, false), null),
            new MotorUrlAdapter(new NavigationStateCodec(new byte[32], encrypt: false)),
            new StubFactory(),
            TestMotorDiagnostics.Factory(bus),
            NullLogger<MotorSessionCoordinator>.Instance);

        await coordinator.HandleDisconnectedAsync("conn-x");

        var failed = Assert.Single(bus.Events, e => e.Name == "Motor.StateExportFailed");
        Assert.Equal("sess-x", failed.PersistedSessionId);
        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(failed.Payload, CamelCase));
        var p = doc.RootElement;
        Assert.Equal("export_failed", p.GetProperty("errorCode").GetString());
        Assert.Equal("export", p.GetProperty("phase").GetString());
        Assert.False(string.IsNullOrWhiteSpace(p.GetProperty("message").GetString()));
        // Envelope carries identity; payload is dedup'd.
        Assert.False(p.TryGetProperty("persistedSessionId", out _));
    }

    [Fact]
    public void SidecarFaulted_payload_includes_errorCode_and_fault()
    {
        var bus = new CapturingBus();
        var session = CreateMotorSession(bus, motorHost: "speculum.com");
        session.ConnectionId = "conn-f";
        session.CorrelationId = "cf";
        session.PersistedSessionId = "ps-f";

        typeof(MotorSession)
            .GetMethod("PublishSidecarFault", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)!
            .Invoke(session, ["sidecar_channel_closed"]);

        var faulted = Assert.Single(bus.Events, e => e.Name == "Motor.SidecarFaulted");
        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(faulted.Payload, CamelCase));
        Assert.Equal("sidecar_channel_closed", doc.RootElement.GetProperty("fault").GetString());
        Assert.Equal("sidecar_channel_closed", doc.RootElement.GetProperty("errorCode").GetString());
    }

    [Fact]
    public async Task NavigateRejected_publishes_errorCode_and_urls()
    {
        var bus = new CapturingBus();
        var registry = new StubRegistry();
        registry.Register("conn-n", new NavigateRejectingSession
        {
            ConnectionId = "conn-n",
            PersistedSessionId = "sess-n",
        });
        var coordinator = new MotorSessionCoordinator(
            registry,
            new StubConfig(),
            new ConfigurableSessionStore(
                new SessionResolveResult("sess-n", ValidToken, false), null),
            new MotorUrlAdapter(new NavigationStateCodec(new byte[32], encrypt: false)),
            new StubFactory(),
            TestMotorDiagnostics.Factory(bus),
            NullLogger<MotorSessionCoordinator>.Instance);

        await Assert.ThrowsAsync<HubException>(() =>
            coordinator.NavigateMotorSessionAsync("conn-n", "https://speculum.com/nav/a", "speculum.com"));

        var rejected = Assert.Single(bus.Events, e => e.Name == "Motor.NavigateRejected");
        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(rejected.Payload, CamelCase));
        var p = doc.RootElement;
        Assert.Equal("navigate_rejected", p.GetProperty("errorCode").GetString());
        Assert.Equal("navigate", p.GetProperty("phase").GetString());
        Assert.False(string.IsNullOrWhiteSpace(p.GetProperty("message").GetString()));
        Assert.False(string.IsNullOrWhiteSpace(p.GetProperty("clientUrl").GetString()));
        Assert.False(string.IsNullOrWhiteSpace(p.GetProperty("targetUrl").GetString()));
    }

    private static MotorSessionCoordinator CreateCoordinator(
        IBrowserSessionStore store,
        IDiagnosticsEventBus bus,
        IMotorSessionFactory? factory = null)
    {
        var urlAdapter = new MotorUrlAdapter(new NavigationStateCodec(new byte[32], encrypt: false));
        return new MotorSessionCoordinator(
            new StubRegistry(),
            new StubConfig(),
            store,
            urlAdapter,
            factory ?? new StubFactory(),
            TestMotorDiagnostics.Factory(bus),
            NullLogger<MotorSessionCoordinator>.Instance);
    }

    private static DiagnosticsEventBus BuildBus(
        DiagnosticsRuntime runtime, IDiagnosticsSink sink, SessionEventRing ring)
    {
        DiagnosticsEventBus? bus = null;
        var self = new Lazy<IDiagnosticsSelfEmitter>(() => new DiagnosticsSelfEmitter(bus!));
        var spans = new SpanTracker(new Lazy<IDiagnosticsEventBus>(() => bus!));
        bus = new DiagnosticsEventBus(runtime, [sink], ring, self, spans, NullLogger<DiagnosticsEventBus>.Instance);
        return bus;
    }

    private static MotorSession CreateMotorSession(IDiagnosticsEventBus bus, string motorHost)
    {
        // encrypt:true — AES-GCM nonce is fresh per Encode; session must cache by target
        // so repeated MSG_STATUS does not churn _w7s_nso / UrlMapped.
        var codec = new NavigationStateCodec(new byte[32], encrypt: true);
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
        return new MotorSession(
            new SidecarBrowserClientOptions { SidecarBaseUrl = "ws://127.0.0.1:9" },
            snapshot,
            adapter,
            new ThrowingSidecarFactory(),
            TestMotorDiagnostics.Events(bus),
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
        private IMotorSession? _active;
        private IMotorSession? _starting;
        public int ActiveCount => _active is null ? 0 : 1;
        public int StartingCount => _starting is null ? 0 : 1;
        public void Register(string connectionId, IMotorSession session) => _active = session;
        public IMotorSession? Get(string connectionId) => _active ?? _starting;
        public bool TryRemove(string connectionId, [NotNullWhen(true)] out IMotorSession? session)
        {
            session = _active;
            _active = null;
            return session is not null;
        }
        public bool TryAcquireSlot(int max) => true;
        public void ReleaseSlot() { }
        public void TrackStarting(string connectionId, IMotorSession session) => _starting = session;
        public bool TryPromoteStarting(string connectionId, IMotorSession session)
        {
            _starting = null;
            _active = session;
            return true;
        }
        public bool TryCancelStarting(string connectionId, [NotNullWhen(true)] out IMotorSession? session)
        {
            session = _starting;
            _starting = null;
            return session is not null;
        }
        public IReadOnlyList<MotorSessionListItem> ListSessions() => [];

        public IReadOnlyList<MotorSessionDiagnosticsSnapshot> ListSnapshots() => [];
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
        public Task StopAllAsync(IBrowserSessionStore store, CancellationToken ct = default, string? correlationId = null) => Task.CompletedTask;
    }

    private sealed class StubFactory : IMotorSessionFactory
    {
        public IMotorSession Create(SessionConfigSnapshot snapshot, IMotorEvents events) => new StubSession();
    }

    private sealed class ThrowingSessionFactory(Exception fail) : IMotorSessionFactory
    {
        public IMotorSession Create(SessionConfigSnapshot snapshot, IMotorEvents events) => new ThrowingStartSession(fail);
    }

    private sealed class ThrowingStartSession(Exception fail) : StubSession
    {
        public override Task StartAsync(CancellationToken ct = default) => Task.FromException(fail);
    }

    private sealed class ExportFailingSession : StubSession
    {
        public override Task<BrowserStatePayload?> CaptureAndPersistAsync(
            string sessionId, IBrowserSessionStore store, CancellationToken ct = default)
            => Task.FromException<BrowserStatePayload?>(new InvalidOperationException("export boom"));
    }

    private sealed class NavigateRejectingSession : StubSession
    {
        public override Task NavigateAsync(string url, CancellationToken ct = default)
            => throw new ArgumentException("domínio não permitido");
    }

    private class StubSession : IMotorSession
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
        public virtual Task StartAsync(CancellationToken ct = default) => Task.CompletedTask;
        public Task StopAsync(CancellationToken ct = default) => Task.CompletedTask;
        public virtual Task<BrowserStatePayload?> CaptureAndPersistAsync(
            string sessionId, IBrowserSessionStore store, CancellationToken ct = default)
            => Task.FromResult<BrowserStatePayload?>(null);
        public ChannelReader<Frame> GetFrameReader() => Channel.CreateUnbounded<Frame>().Reader;
        public ChannelReader<ConsoleOutput> GetConsoleOutputReader()
            => Channel.CreateUnbounded<ConsoleOutput>().Reader;
        public ChannelReader<SessionStatus> GetStatusReader()
            => Channel.CreateUnbounded<SessionStatus>().Reader;
        public Task ConsumeUserInputAsync(ChannelReader<string> channelReader) => Task.CompletedTask;
        public Task ConsumeConsoleInputAsync(ChannelReader<ConsoleInput> channelReader) => Task.CompletedTask;
        public virtual Task NavigateAsync(string url, CancellationToken ct = default) => Task.CompletedTask;
        public Task<Speculum.Api.Motor.Live.Models.ResizeResult> ResizeAsync(int width, int height, Speculum.Api.Motor.Live.DeviceProfile? device = null, CancellationToken ct = default) => Task.FromResult(new Speculum.Api.Motor.Live.Models.ResizeResult { Applied = true, Width = width, Height = height });
    }

    private sealed class ThrowingSidecarFactory : ISidecarClientFactory
    {
        public ISidecarClient Create(string sessionId)
            => throw new InvalidOperationException("sidecar not used in UrlMapped unit test");
    }
}
