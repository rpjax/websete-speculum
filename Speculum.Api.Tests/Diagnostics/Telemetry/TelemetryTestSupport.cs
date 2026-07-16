using System.Diagnostics.CodeAnalysis;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Speculum.Api.BrowserPersistence;
using Speculum.Api.Config.Bootstrap;
using Speculum.Api.Config.Runtime;
using Speculum.Api.Config.Store;
using Speculum.Api.Diagnostics.Abstractions;
using Speculum.Api.Diagnostics.Configuration;
using Speculum.Api.Diagnostics.Emitters;
using Speculum.Api.Diagnostics.Pipeline;
using Speculum.Api.Diagnostics.Probes;
using Speculum.Api.Diagnostics.Telemetry;
using Speculum.Api.Motor.Live;

namespace Speculum.Api.Tests.Telemetry;

/// <summary>Shared fakes/builders for Diagnostics.Telemetry unit tests.</summary>
internal static class TelemetryTestSupport
{
    public static DiagnosticsRuntime Runtime(DiagnosticsOptions options)
    {
        var runtime = new DiagnosticsRuntime();
        runtime.ApplyOptions(options);
        return runtime;
    }

    public static Lazy<ISpeculumConfigStore> ConfigStore(int? maxSessions)
        => new(() => new FakeConfigStore(maxSessions));

    /// <summary>Concrete transport bus (needed to exercise the breaker-pressure accessor).</summary>
    public static DiagnosticsEventBus RealBus(IDiagnosticsRuntime runtime)
    {
        DiagnosticsEventBus bus = null!;
        bus = new DiagnosticsEventBus(
            runtime,
            [new NullDiagnosticsSink()],
            new SessionEventRing(),
            new Lazy<IDiagnosticsSelfEmitter>(() => new DiagnosticsSelfEmitter(bus)),
            new SpanTracker(new Lazy<IDiagnosticsEventBus>(() => bus)),
            NullLogger<DiagnosticsEventBus>.Instance);
        return bus;
    }

    public static BootstrapConfig Bootstrap(string databasePath)
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["HttpAddress"] = "127.0.0.1:8080",
                ["Database:Path"] = databasePath,
                ["Sidecar:BaseUrl"] = "http://localhost:9000",
            })
            .Build();
        return BootstrapConfig.Load(config);
    }

    public static MotorSessionDiagnosticsSnapshot Snap(
        string connectionId,
        MotorSessionPhase phase = MotorSessionPhase.Running,
        double fps = 30,
        long uptimeMs = 1000,
        int inputQueue = 0,
        int frameChannelDepth = 0,
        int statusChannelDepth = 0,
        bool sidecarConnected = true,
        bool jsBridgeEnabled = false,
        string? lastFault = null,
        string currentUrl = "")
        => new()
        {
            ConnectionId = connectionId,
            Phase = phase,
            Fps = fps,
            UptimeMs = uptimeMs,
            InputQueueApprox = inputQueue,
            FrameChannelDepth = frameChannelDepth,
            StatusChannelDepth = statusChannelDepth,
            SidecarConnected = sidecarConnected,
            JsBridgeEnabled = jsBridgeEnabled,
            LastFault = lastFault,
            CurrentUrl = currentUrl,
        };

    public static BrowserSessionMetadata SessionMeta(
        string sessionId,
        int cookies = 0,
        int history = 0,
        DateTimeOffset? expiresAt = null)
        => new()
        {
            SessionId = sessionId,
            ClientToken = "tok-" + sessionId,
            CreatedAt = DateTimeOffset.UtcNow.AddHours(-1),
            UpdatedAt = DateTimeOffset.UtcNow,
            ExpiresAt = expiresAt ?? DateTimeOffset.UtcNow.AddHours(24),
            CookieCount = cookies,
            HistoryCount = history,
        };

    /// <summary>Builds a composer wired with the real section sources over the given fakes.</summary>
    public static TelemetrySampleComposer Composer(
        IReadOnlyList<MotorSessionDiagnosticsSnapshot> snapshots,
        IDiagnosticsRuntime runtime,
        int? maxSessions = 4,
        IReadOnlyList<BrowserSessionMetadata>? sessions = null,
        string? databasePath = null)
    {
        var host = new HostTelemetrySource(new HostResourceProbe(), runtime);
        var motor = new MotorTelemetrySource(ConfigStore(maxSessions));
        var sidecar = new SidecarTelemetrySource();
        var persistence = new PersistenceTelemetrySource(
            new FakeBrowserSessionStore(sessions ?? []),
            Bootstrap(databasePath ?? Path.Combine(Path.GetTempPath(), $"speculum-tel-{Guid.NewGuid():N}.db")));
        var pipeline = new PipelineTelemetrySource(runtime, RealBus(runtime));
        return new TelemetrySampleComposer(host, motor, sidecar, persistence, pipeline, new FakeRegistry(snapshots));
    }

    internal sealed class CapturingBus : IDiagnosticsEventBus
    {
        public List<DiagnosticsEvent> Events { get; } = [];
        public bool LastPersist { get; private set; } = true;

        public void Publish(DiagnosticsEvent diagnosticsEvent, bool persist = true)
        {
            LastPersist = persist;
            Events.Add(diagnosticsEvent);
        }
    }

    internal sealed class FakeConfigStore(int? maxSessions) : ISpeculumConfigStore
    {
        public SpeculumRuntimeConfig Current { get; } = new() { MaxSessions = maxSessions };
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

    internal sealed class FakeBrowserSessionStore(IReadOnlyList<BrowserSessionMetadata> sessions)
        : IBrowserSessionStore
    {
        public Task InitializeAsync(CancellationToken ct = default) => Task.CompletedTask;
        public Task<string> ResolveOrCreateSessionAsync(string clientToken, CancellationToken ct = default)
            => Task.FromResult("");
        public Task<SessionResolveResult> ResolveOrCreateSessionAsync(SessionIdentity identity, CancellationToken ct = default)
            => throw new NotSupportedException();
        public Task<BrowserStatePayload?> LoadStateAsync(string sessionId, CancellationToken ct = default)
            => Task.FromResult<BrowserStatePayload?>(null);
        public Task SaveStateAsync(string sessionId, BrowserStatePayload state, CancellationToken ct = default)
            => Task.CompletedTask;
        public Task<IReadOnlyList<BrowserSessionMetadata>> ListSessionsAsync(CancellationToken ct = default)
            => Task.FromResult(sessions);
        public Task<BrowserSessionDetail?> GetSessionDetailAsync(string sessionId, CancellationToken ct = default)
            => Task.FromResult<BrowserSessionDetail?>(null);
        public Task<bool> DeleteSessionAsync(string sessionId, CancellationToken ct = default)
            => Task.FromResult(false);
        public Task RefreshPolicyAsync(CancellationToken ct = default) => Task.CompletedTask;
        public Task PurgeExpiredAsync(CancellationToken ct = default) => Task.CompletedTask;
    }

    internal sealed class FakeRegistry(IReadOnlyList<MotorSessionDiagnosticsSnapshot> snapshots)
        : IMotorSessionRegistry
    {
        public int ActiveCount => 0;
        public int StartingCount => 0;
        public void Register(string connectionId, IMotorSession session) { }
        public IMotorSession? Get(string connectionId) => null;
        public bool TryRemove(string connectionId, [NotNullWhen(true)] out IMotorSession? session)
        {
            session = null;
            return false;
        }
        public bool TryAcquireSlot(int max) => true;
        public void ReleaseSlot() { }
        public void TrackStarting(string connectionId, IMotorSession session) { }
        public bool TryPromoteStarting(string connectionId, IMotorSession session) => true;
        public bool TryCancelStarting(string connectionId, [NotNullWhen(true)] out IMotorSession? session)
        {
            session = null;
            return false;
        }
        public IReadOnlyList<MotorSessionListItem> ListSessions() => [];
        public IReadOnlyList<MotorSessionDiagnosticsSnapshot> ListSnapshots() => snapshots;
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
            string? correlationId = null) => Task.CompletedTask;
    }
}
