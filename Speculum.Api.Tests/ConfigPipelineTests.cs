using System.Diagnostics.CodeAnalysis;
using Speculum.Api.Config.Application;
using Speculum.Api.Config.Runtime;
using Speculum.Api.Config.Store;
using Speculum.Api.Diagnostics.Abstractions;
using Speculum.Api.Edge;
using Speculum.Api.Motor.Diagnostics;
using Speculum.Api.Motor.Live;
using Speculum.Api.BrowserPersistence;

namespace Speculum.Api.Tests;

public sealed class ConfigPipelineTests
{
    [Fact]
    public async Task Hosting_post_reload_synchronizes_edge_once()
    {
        var sync = new RecordingEdgeSynchronizer();
        var handler = new EdgeSyncConfigHandler(sync);

        await handler.HandleAsync(Context(ConfigSectionKeys.Hosting, ConfigChangePhase.PostReload));

        Assert.Equal(1, sync.SyncCount);
    }

    [Fact]
    public async Task Hosting_pre_reload_does_not_synchronize_edge()
    {
        var sync = new RecordingEdgeSynchronizer();
        var handler = new EdgeSyncConfigHandler(sync);

        await handler.HandleAsync(Context(ConfigSectionKeys.Hosting, ConfigChangePhase.PreReload));

        Assert.Equal(0, sync.SyncCount);
    }

    [Fact]
    public async Task Forwarding_post_reload_does_not_synchronize_edge()
    {
        var sync = new RecordingEdgeSynchronizer();
        var handler = new EdgeSyncConfigHandler(sync);

        await handler.HandleAsync(Context(ConfigSectionKeys.Forwarding, ConfigChangePhase.PostReload));

        Assert.Equal(0, sync.SyncCount);
    }

    [Fact]
    public async Task Forwarding_pre_reload_drains_motor_sessions()
    {
        var registry = new RecordingMotorSessionRegistry();
        var handler = new MotorSessionDrainHandler(registry, new NoOpBrowserSessionStore(), TestMotorDiagnostics.Factory(new NullDiagnosticsEventBus()));

        await handler.HandleAsync(Context(ConfigSectionKeys.Forwarding, ConfigChangePhase.PreReload));

        Assert.Equal(1, registry.StopAllCount);
    }

    [Fact]
    public async Task Hosting_pre_reload_drains_motor_sessions()
    {
        var registry = new RecordingMotorSessionRegistry();
        var handler = new MotorSessionDrainHandler(registry, new NoOpBrowserSessionStore(), TestMotorDiagnostics.Factory(new NullDiagnosticsEventBus()));

        await handler.HandleAsync(Context(ConfigSectionKeys.Hosting, ConfigChangePhase.PreReload));

        Assert.Equal(1, registry.StopAllCount);
    }

    [Fact]
    public async Task MaxSessions_pre_reload_does_not_drain_or_sync()
    {
        var registry = new RecordingMotorSessionRegistry();
        var sync = new RecordingEdgeSynchronizer();
        var drainHandler = new MotorSessionDrainHandler(registry, new NoOpBrowserSessionStore(), TestMotorDiagnostics.Factory(new NullDiagnosticsEventBus()));
        var syncHandler = new EdgeSyncConfigHandler(sync);

        await drainHandler.HandleAsync(Context(ConfigSectionKeys.MaxSessions, ConfigChangePhase.PreReload));
        await syncHandler.HandleAsync(Context(ConfigSectionKeys.MaxSessions, ConfigChangePhase.PostReload));

        Assert.Equal(0, registry.StopAllCount);
        Assert.Equal(0, sync.SyncCount);
    }

    private static ConfigChangeContext Context(string sectionKey, ConfigChangePhase phase) => new()
    {
        SectionKey = sectionKey,
        Phase      = phase,
        Result     = new ConfigUpdateResult { Success = true },
    };

    private sealed class RecordingEdgeSynchronizer : IEdgeSynchronizer
    {
        public int SyncCount { get; private set; }

        public Task SynchronizeAsync(CancellationToken ct = default)
        {
            SyncCount++;
            return Task.CompletedTask;
        }
    }

    private sealed class RecordingMotorSessionRegistry : IMotorSessionRegistry
    {
        public int StopAllCount { get; private set; }
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

        public Task StopAllAsync(IBrowserSessionStore sessionStore, CancellationToken ct = default, string? correlationId = null)
        {
            StopAllCount++;
            return Task.CompletedTask;
        }
    }

    private sealed class NoOpBrowserSessionStore : IBrowserSessionStore
    {
        public Task InitializeAsync(CancellationToken ct = default) => Task.CompletedTask;
        public Task<string> ResolveOrCreateSessionAsync(string clientToken, CancellationToken ct = default)
            => Task.FromResult("id");
        public Task<SessionResolveResult> ResolveOrCreateSessionAsync(
            SessionIdentity identity, CancellationToken ct = default)
            => Task.FromResult(new SessionResolveResult("id", "token", Restored: false));
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
