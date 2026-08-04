using Speculum.Api.Configurations.Services.Contracts;
using System.Diagnostics.CodeAnalysis;
using System.Threading.Channels;
using Aidan.Core.Errors;
using Aidan.Core.Patterns;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Speculum.Api.BrowserClients;
using Speculum.Api.Configurations.Models.Sessions;
using Speculum.Api.Profiles.Aggregates;
using Speculum.Api.Profiles.Responses;
using Speculum.Api.Profiles.Services.Contracts;
using Speculum.Api.Sessions.Aggregates;
using Speculum.Api.Sessions.Events.Models;
using Speculum.Api.Sessions.Events.Services.Contracts;
using Speculum.Api.Sessions.Mirror.DomProjection;
using Speculum.Api.Sessions.Models;
using Speculum.Api.Sessions.Requests;
using Speculum.Api.Sessions.Services;
using Speculum.Api.Sessions.Services.Contracts;
using Speculum.Api.Shared.Services;
using ScreenResolution = Speculum.Api.Sessions.Models.ScreenResolution;

namespace Speculum.Api.Sessions.Tests;

public sealed class SessionServiceTests
{
    [Fact]
    public async Task StartSession_WithMockResolver_Succeeds()
    {
        var profileId = Guid.NewGuid();
        var profiles = new InMemoryProfileRepository();
        await profiles.SaveAsync(Profile.Create(profileId));

        var sessions = new InMemorySessionRepository();
        var slots = new SessionSlotRegistry(SessionsTestHarness.Configuration());
        var collector = new RecordingCollector();
        var browser = new FakeBrowserClient();
        var urls = new FixedUrlResolver("https://example.test/");
        var live = CreateLiveSessionService(urls, collector);

        var service = new SessionService(
            profiles,
            sessions,
            slots,
            collector,
            live,
            urls,
            new NoOpSessionEventsFactory(),
            new NoOpSessionTelemetryEventsFactory(),
            browser,
            new FixedSessionTokenGenerator("test-auth-token"),
            new ScopedMutex(),
            new SessionBindingRegistry(live),
            new SessionsTestHarness.StaticConfigurationService(SessionsTestHarness.Engine()),
            new NoOpSessionDrainOrchestrator(),
            new LaunchScriptResolver());

        var result = await service.StartSessionAsync(SessionsTestHarness.Start(profileId));

        Assert.True(result.IsSuccess);
        Assert.Equal("test-auth-token", result.Value.Token);
        var loaded = await sessions.LoadAsync(result.Value.SessionId);
        Assert.NotNull(loaded);
        Assert.Equal(profileId, loaded.ProfileId);
        Assert.Equal("test-auth-token", loaded.AuthToken);
        Assert.True(live.TryGet(result.Value.SessionId, out _));
        Assert.Contains(result.Value.SessionId, collector.Watched);
        Assert.Equal("speculum.test", urls.LastRequestHost);
        Assert.True(browser.TryGetConnection(result.Value.SessionId, out var connection));
        var fakeConnection = Assert.IsType<FakeSessionConnection>(connection);
        Assert.NotNull(fakeConnection.LastLaunchConfiguration);
        Assert.Equal(800, fakeConnection.LastLaunchConfiguration.Resolution!.Width);
        Assert.Equal("en-US", fakeConnection.LastLaunchConfiguration.ClientEnvironment!.Locale);
        Assert.True(fakeConnection.LastLaunchConfiguration.JsBridgeEnabled);
    }

    [Fact]
    public async Task StartSession_WhenPendingConfig_Fails()
    {
        var profileId = Guid.NewGuid();
        var profiles = new InMemoryProfileRepository();
        await profiles.SaveAsync(Profile.Create(profileId));

        var configuration = SessionsTestHarness.Configuration();
        configuration.ReplaceApplied(
            new EngineConfiguration(),
            new Configurations.Models.Journal.JournalEventsConfiguration(),
            ["Navigation", "Sessions", "ResourceManagement"]);

        var live = CreateLiveSessionService(
            new FixedUrlResolver("https://example.test/"),
            new RecordingCollector());
        var service = new SessionService(
            profiles,
            new InMemorySessionRepository(),
            new SessionSlotRegistry(configuration),
            new RecordingCollector(),
            live,
            new FixedUrlResolver("https://example.test/"),
            new NoOpSessionEventsFactory(),
            new NoOpSessionTelemetryEventsFactory(),
            new FakeBrowserClient(),
            new FixedSessionTokenGenerator("tok"),
            new ScopedMutex(),
            new SessionBindingRegistry(live),
            configuration,
            new NoOpSessionDrainOrchestrator(),
            new LaunchScriptResolver());

        var result = await service.StartSessionAsync(SessionsTestHarness.Start(profileId));

        Assert.True(result.IsFailure);
        Assert.Contains(
            result.Errors,
            e => e.Message?.Contains("Pending config", StringComparison.Ordinal) == true);
    }

    [Fact]
    public async Task StartSession_WhenDraining_Fails()
    {
        var profileId = Guid.NewGuid();
        var profiles = new InMemoryProfileRepository();
        await profiles.SaveAsync(Profile.Create(profileId));

        var live = CreateLiveSessionService(
            new FixedUrlResolver("https://example.test/"),
            new RecordingCollector());
        var service = new SessionService(
            profiles,
            new InMemorySessionRepository(),
            new SessionSlotRegistry(SessionsTestHarness.Configuration()),
            new RecordingCollector(),
            live,
            new FixedUrlResolver("https://example.test/"),
            new NoOpSessionEventsFactory(),
            new NoOpSessionTelemetryEventsFactory(),
            new FakeBrowserClient(),
            new FixedSessionTokenGenerator("tok"),
            new ScopedMutex(),
            new SessionBindingRegistry(live),
            new SessionsTestHarness.StaticConfigurationService(SessionsTestHarness.Engine()),
            new AlwaysDrainingOrchestrator(),
            new LaunchScriptResolver());

        var result = await service.StartSessionAsync(SessionsTestHarness.Start(profileId));

        Assert.True(result.IsFailure);
        Assert.Contains(
            result.Errors,
            e => e.Message?.Contains("draining", StringComparison.OrdinalIgnoreCase) == true);
    }

    private sealed class AlwaysDrainingOrchestrator : ISessionDrainOrchestrator
    {
        public bool IsDraining => true;

        public Task DrainAsync(SessionDrainRequest request, CancellationToken ct = default)
            => Task.CompletedTask;
    }

    [Fact]
    public async Task StartSession_SameCaller_ReplacesPriorLiveSession()
    {
        var profileId = Guid.NewGuid();
        var profiles = new InMemoryProfileRepository();
        await profiles.SaveAsync(Profile.Create(profileId));
        var sessions = new InMemorySessionRepository();
        var slots = new SessionSlotRegistry(SessionsTestHarness.Configuration());
        var collector = new RecordingCollector();
        var browser = new FakeBrowserClient();
        var urls = new FixedUrlResolver("https://example.test/");
        var live = CreateLiveSessionService(urls, collector);
        var bindings = new SessionBindingRegistry(live);
        var service = new SessionService(
            profiles,
            sessions,
            slots,
            collector,
            live,
            urls,
            new NoOpSessionEventsFactory(),
            new NoOpSessionTelemetryEventsFactory(),
            browser,
            new FixedSessionTokenGenerator("tok"),
            new ScopedMutex(),
            bindings,
            new SessionsTestHarness.StaticConfigurationService(SessionsTestHarness.Engine()),
            new NoOpSessionDrainOrchestrator(),
            new LaunchScriptResolver());
        var firstRequest = SessionsTestHarness.Start(profileId);
        firstRequest.CallerId = "caller";
        var secondRequest = SessionsTestHarness.Start(profileId);
        secondRequest.CallerId = "caller";

        var first = await service.StartSessionAsync(firstRequest);
        var second = await service.StartSessionAsync(secondRequest);

        Assert.True(first.IsSuccess);
        Assert.True(second.IsSuccess);
        var replaced = await sessions.LoadAsync(first.Value.SessionId);
        Assert.NotNull(replaced);
        Assert.Equal(LifecycleState.Stopped, replaced.State);
        Assert.Equal(StopReason.Replaced, replaced.StopReason);
        Assert.False(browser.TryGetConnection(first.Value.SessionId, out _));
        Assert.True(browser.TryGetConnection(second.Value.SessionId, out _));
    }

    [Fact]
    public async Task StopSession_ReleasesLiveContextAndConnection()
    {
        var profileId = Guid.NewGuid();
        var profiles = new InMemoryProfileRepository();
        await profiles.SaveAsync(Profile.Create(profileId));

        var sessions = new InMemorySessionRepository();
        var slots = new SessionSlotRegistry(SessionsTestHarness.Configuration());
        var collector = new RecordingCollector();
        var browser = new FakeBrowserClient();
        var urls = new FixedUrlResolver("https://example.test/");
        var live = CreateLiveSessionService(urls, collector);

        var service = new SessionService(
            profiles,
            sessions,
            slots,
            collector,
            live,
            urls,
            new NoOpSessionEventsFactory(),
            new NoOpSessionTelemetryEventsFactory(),
            browser,
            new FixedSessionTokenGenerator("tok"),
            new ScopedMutex(),
            new SessionBindingRegistry(live),
            new SessionsTestHarness.StaticConfigurationService(SessionsTestHarness.Engine()),
            new NoOpSessionDrainOrchestrator(),
            new LaunchScriptResolver());

        var started = await service.StartSessionAsync(SessionsTestHarness.Start(profileId));
        Assert.True(started.IsSuccess);
        var sessionId = started.Value.SessionId;
        Assert.True(live.TryGet(sessionId, out var handle));
        Assert.NotNull(handle);
        Assert.True(handle.Attach(new NoOpAttachedClient()).IsFailure);

        var stopped = await service.StopSessionAsync(new StopSession { SessionId = sessionId });
        Assert.True(stopped.IsSuccess);

        Assert.False(live.TryGet(sessionId, out _));
        Assert.False(browser.TryGetConnection(sessionId, out _));
        Assert.False(slots.IsAquired(sessionId));
        Assert.Contains(sessionId, collector.Unwatched);

        var loaded = await sessions.LoadAsync(sessionId);
        Assert.NotNull(loaded);
        Assert.Equal(LifecycleState.Stopped, loaded.State);
    }

    [Fact]
    public async Task StartSession_WhenLiveCreateFails_AbortsPersistedSession()
    {
        var profileId = Guid.NewGuid();
        var profiles = new InMemoryProfileRepository();
        await profiles.SaveAsync(Profile.Create(profileId));

        var sessions = new InMemorySessionRepository();
        var slots = new SessionSlotRegistry(SessionsTestHarness.Configuration());
        var collector = new RecordingCollector();
        var browser = new FakeBrowserClient();
        var urls = new FixedUrlResolver("https://example.test/");
        var live = new FailingLiveSessionService();

        var service = new SessionService(
            profiles,
            sessions,
            slots,
            collector,
            live,
            urls,
            new NoOpSessionEventsFactory(),
            new NoOpSessionTelemetryEventsFactory(),
            browser,
            new FixedSessionTokenGenerator("tok"),
            new ScopedMutex(),
            new SessionBindingRegistry(live),
            new SessionsTestHarness.StaticConfigurationService(SessionsTestHarness.Engine()),
            new NoOpSessionDrainOrchestrator(),
            new LaunchScriptResolver());

        var result = await service.StartSessionAsync(SessionsTestHarness.Start(profileId));

        Assert.True(result.IsFailure);
        Assert.Empty(collector.Watched);
        Assert.False(browser.TryGetConnection(sessions.LastSavedId, out _));
        Assert.False(slots.IsAquired(sessions.LastSavedId));

        var loaded = await sessions.LoadAsync(sessions.LastSavedId);
        Assert.NotNull(loaded);
        Assert.Equal(LifecycleState.Aborted, loaded.State);
    }

    [Fact]
    public async Task StartSession_ProfileNotFound_Fails()
    {
        var sessions = new InMemorySessionRepository();
        var browser = new FakeBrowserClient();
        var urls = new FixedUrlResolver("https://example.test/");
        var collector = new RecordingCollector();
        var live = CreateLiveSessionService(urls, collector);

        var service = new SessionService(
            new InMemoryProfileRepository(),
            sessions,
            new SessionSlotRegistry(SessionsTestHarness.Configuration()),
            collector,
            live,
            urls,
            new NoOpSessionEventsFactory(),
            new NoOpSessionTelemetryEventsFactory(),
            browser,
            new FixedSessionTokenGenerator("unused"),
            new ScopedMutex(),
            new SessionBindingRegistry(live),
            new SessionsTestHarness.StaticConfigurationService(SessionsTestHarness.Engine()),
            new NoOpSessionDrainOrchestrator(),
            new LaunchScriptResolver());

        var result = await service.StartSessionAsync(SessionsTestHarness.Start(Guid.NewGuid()));

        Assert.True(result.IsFailure);
    }

    [Fact]
    public async Task StartSession_IncompleteEngineConfiguration_FailsBeforeBrowserConnection()
    {
        var profileId = Guid.NewGuid();
        var profiles = new InMemoryProfileRepository();
        await profiles.SaveAsync(Profile.Create(profileId));
        var browser = new FakeBrowserClient();
        var urls = new FixedUrlResolver("https://example.test/");
        var collector = new RecordingCollector();
        var live = CreateLiveSessionService(urls, collector);
        var service = new SessionService(
            profiles,
            new InMemorySessionRepository(),
            new SessionSlotRegistry(SessionsTestHarness.Configuration()),
            collector,
            live,
            urls,
            new NoOpSessionEventsFactory(),
            new NoOpSessionTelemetryEventsFactory(),
            browser,
            new FixedSessionTokenGenerator("unused"),
            new ScopedMutex(),
            new SessionBindingRegistry(live),
            new SessionsTestHarness.StaticConfigurationService(new()
            {
                Sessions = SessionsTestHarness.Sessions(),
                ResourceManagement = SessionsTestHarness.ResourceManagement(),
            }),
            new NoOpSessionDrainOrchestrator(),
            new LaunchScriptResolver());

        var result = await service.StartSessionAsync(SessionsTestHarness.Start(profileId));

        Assert.True(result.IsFailure);
        Assert.Equal(0, browser.ConnectionCount);
    }

    private static LiveSessionService CreateLiveSessionService(
        IUrlResolver urls,
        ISessionCollector collector)
    {
        return new LiveSessionService(
            collector,
            new NoOpFaultScheduler(),
            urls,
            SessionsTestHarness.Configuration(new SessionsConfiguration
            {
                IsJsBridgeEnabled = true,
                DetachedSessionTimeout = TimeSpan.FromMinutes(5),
                InputMultiplexingPolicy = new InputMultiplexingPolicy
                {
                    Access = InputAccessPolicy.Shared,
                },
            }),
            new NoOpSessionEventsFactory(),
            new NoOpSessionTelemetryEventsFactory(),
            new Speculum.Api.Journal.Services.JournalCatalog(),
            NullLoggerFactory.Instance);
    }

    private sealed class NoOpFaultScheduler : ISessionFaultScheduler
    {
        public void RequestStop(Guid sessionId, StopReason reason) { }
    }

    private sealed class NoOpSessionEventsFactory : ISessionEventsFactory
    {
        public ISessionLifecycleEvents ForSessionLifecycle(Guid sessionId, Guid profileId)
            => new NoOpLifecycleEvents();

        public ISessionStartEvents ForSessionStart(Guid sessionId, Guid profileId)
            => new NoOpStartEvents();

        public ISessionStopEvents ForSessionStop(Guid sessionId, Guid profileId)
            => new NoOpStopEvents();

        public ISessionLiveEvents ForSessionLive(Guid sessionId, Guid profileId)
            => new NoOpSessionLiveEvents();

        public ISessionLifecycleEvents ForSessionLifecycle(Session session)
            => new NoOpLifecycleEvents();

        public ISessionStartEvents ForSessionStart(Session session)
            => new NoOpStartEvents();

        public ISessionStopEvents ForSessionStop(Session session)
            => new NoOpStopEvents();

        public ISessionLiveEvents ForSessionLive(Session session)
            => new NoOpSessionLiveEvents();
    }

    private sealed class FixedUrlResolver(string url) : IUrlResolver
    {
        public string? LastRequestHost { get; private set; }

        public IResult<string> Resolve(string path, string query, string requestHost)
        {
            LastRequestHost = requestHost;
            return Result<string>.Success(url);
        }

        public IResult<string> ProjectToClient(string targetUrl, string requestHost)
        {
            LastRequestHost = requestHost;
            return Result<string>.Success(url);
        }
    }

    private sealed class FixedSessionTokenGenerator(string token) : ISessionTokenGenerator
    {
        public string GetRandom() => token;
    }

    private sealed class NoOpLifecycleEvents : ISessionLifecycleEvents
    {
        public void Starting() { }
        public void Started() { }
        public void Stopping(StopReason reason) { }
        public void Stopped(StopReason reason) { }
        public void TimedOut(StopReason reason) { }
        public void Aborted(StopReason reason, JournalError[]? errors = null) { }
    }

    private sealed class NoOpStartEvents : ISessionStartEvents
    {
        public void ConnectionStarted() { }
        public void BrowserLaunched() { }
        public void ProfileStateRestored(CookieNormalizeStats cookieNormalize) { }
        public void InitialNavigationCompleted(string url) { }
        public void ProfileNotFound() { }
        public void StartConfigurationRejected(Error[] errors) { }
        public void StartRefused(string reason, Error[]? errors = null) { }
        public void ConnectionStartFailed(Error[] errors) { }
        public void LaunchBrowserFailed(Error[] errors) { }
        public void RestoreProfileStateFailed(Error[] errors) { }
        public void InitialNavigationFailed(Error[] errors, string phase, string? url = null) { }
    }

    private sealed class NoOpStopEvents : ISessionStopEvents
    {
        public void SessionStatePersisted() { }
        public void ExportSessionStateFailed(Error[] errors) { }
        public void ExportSessionStateSkipped(string reason) { }
        public void CloseBrowserFailed(Error[] errors) { }
        public void CloseConnectionFailed(Error[] errors) { }
        public void BrowserClosed() { }
        public void ConnectionClosed() { }
    }

    private sealed class InMemorySessionRepository : ISessionRepository
    {
        private readonly Dictionary<Guid, Session> _sessions = new();

        public Guid LastSavedId { get; private set; }

        public Task<Session?> LoadAsync(Guid sessionId, CancellationToken ct = default)
            => Task.FromResult(_sessions.GetValueOrDefault(sessionId));

        public Task SaveAsync(Session session, CancellationToken ct = default)
        {
            _sessions[session.Id] = session;
            LastSavedId = session.Id;
            return Task.CompletedTask;
        }

        public Task<Guid?> TryGetLiveSessionIdByProfileAsync(Guid profileId, CancellationToken ct = default)
            => Task.FromResult(
                _sessions.Values
                    .Where(s => s.ProfileId == profileId && s.State == LifecycleState.Live)
                    .Select(s => (Guid?)s.Id)
                    .FirstOrDefault());

        public Task<IReadOnlySet<Guid>> ListLiveProfileIdsAsync(CancellationToken ct = default)
            => Task.FromResult<IReadOnlySet<Guid>>(
                _sessions.Values
                    .Where(s => s.State == LifecycleState.Live)
                    .Select(s => s.ProfileId)
                    .ToHashSet());

        public Task<int> DeleteNonLiveByProfileAsync(Guid profileId, CancellationToken ct = default)
        {
            var remove = _sessions.Values
                .Where(s => s.ProfileId == profileId && s.State != LifecycleState.Live)
                .Select(s => s.Id)
                .ToArray();
            foreach (var id in remove)
                _sessions.Remove(id);
            return Task.FromResult(remove.Length);
        }
    }

    private sealed class RecordingCollector : ISessionCollector
    {
        public List<Guid> Watched { get; } = [];
        public List<Guid> Unwatched { get; } = [];

        public void Watch(Guid sessionId) => Watched.Add(sessionId);
        public void AddRef(Guid sessionId) { }
        public void Release(Guid sessionId) { }
        public void Unwatch(Guid sessionId) => Unwatched.Add(sessionId);
    }

    private sealed class NoOpAttachedClient : IAttachedSessionClient
    {
        public Task SyncUrlAsync(string url, CancellationToken cancellationToken = default)
            => Task.CompletedTask;

        public Task RedirectAsync(string url, CancellationToken cancellationToken = default)
            => Task.CompletedTask;

        public Task EditableFocusChangedAsync(
            EditingState? editing,
            CancellationToken cancellationToken = default)
            => Task.CompletedTask;

        public Task SessionEndedAsync(
            Guid sessionId,
            string reason,
            string? errorCode = null,
            string? message = null,
            CancellationToken cancellationToken = default)
            => Task.CompletedTask;
    }

    private sealed class FailingLiveSessionService : ILiveSessionService
    {
        public IResult<ILiveSession> Create(
            Guid sessionId,
            Guid profileId,
            ISessionConnection connection,
            string requestHost,
            bool jsBridgeEnabled)
            => Result<ILiveSession>.Failure("live create failed");

        public bool TryGet(Guid sessionId, [NotNullWhen(true)] out ILiveSession? session)
        {
            session = null;
            return false;
        }

        public IReadOnlyList<LiveSessionTelemetrySnapshot> ListSnapshots() => [];

        public void Release(Guid sessionId) { }
    }

    private sealed class InMemoryProfileRepository : IProfileRepository
    {
        private readonly Dictionary<Guid, Profile> _profiles = new();

        public Task<bool> ExistsAsync(Guid profileId, CancellationToken ct = default)
            => Task.FromResult(_profiles.ContainsKey(profileId));

        public Task<Profile?> LoadAsync(Guid profileId, CancellationToken ct = default)
            => Task.FromResult(_profiles.GetValueOrDefault(profileId));

        public Task SaveAsync(Profile profile, CancellationToken ct = default)
        {
            _profiles[profile.Id] = profile;
            return Task.CompletedTask;
        }

        public Task<bool> MergeSessionExportAsync(
            Guid profileId,
            SessionState export,
            CancellationToken ct = default)
        {
            if (!_profiles.TryGetValue(profileId, out var profile))
                return Task.FromResult(false);

            profile.ApplySessionExport(export);
            return Task.FromResult(true);
        }

        public Task TouchLastUsedAsync(Guid profileId, CancellationToken ct = default)
            => Task.CompletedTask;

        public Task<IReadOnlyList<Guid>> ListExpiredInactiveAsync(
            DateTimeOffset olderThan,
            int take,
            IReadOnlySet<Guid> excludeLiveProfileIds,
            CancellationToken ct = default)
            => Task.FromResult<IReadOnlyList<Guid>>(Array.Empty<Guid>());

        public Task<ProfileSummary?> GetSummaryAsync(Guid profileId, CancellationToken ct = default)
        {
            if (!_profiles.TryGetValue(profileId, out var profile))
                return Task.FromResult<ProfileSummary?>(null);

            return Task.FromResult<ProfileSummary?>(new ProfileSummary
            {
                ProfileId = profile.Id,
                CreatedAt = DateTimeOffset.UtcNow,
                LastUsedAt = DateTimeOffset.UtcNow,
                CookieCount = profile.State.Cookies.Count,
                LocalStorageCount = profile.State.LocalStorage.Count,
                IdbRecordCount = profile.State.IdbRecords.Count,
                HistoryCount = profile.State.History.Count,
            });
        }

        public Task<(IReadOnlyList<ProfileListItem> Items, int Total)> ListAsync(
            int skip,
            int take,
            CancellationToken ct = default)
        {
            var all = _profiles.Values
                .Select(p => new ProfileListItem
                {
                    ProfileId = p.Id,
                    CreatedAt = DateTimeOffset.UtcNow,
                    LastUsedAt = DateTimeOffset.UtcNow,
                })
                .ToList();
            return Task.FromResult<(IReadOnlyList<ProfileListItem>, int)>((
                all.Skip(skip).Take(take).ToList(),
                all.Count));
        }

        public Task<bool> DeleteAsync(Guid profileId, CancellationToken ct = default)
            => Task.FromResult(_profiles.Remove(profileId));
    }

    private sealed class FakeBrowserClient : IBrowserClient
    {
        private readonly Dictionary<Guid, FakeSessionConnection> _connections = new();
        public int ConnectionCount => _connections.Count;

        public bool TryGetConnection(Guid sessionId, [NotNullWhen(true)] out ISessionConnection? connection)
        {
            if (_connections.TryGetValue(sessionId, out var fake))
            {
                connection = fake;
                return true;
            }

            connection = null;
            return false;
        }

        public Task<IResult> UpdateBrowserConfigsAsync(CancellationToken ct = default)
            => Task.FromResult<IResult>(Result.Success());

        public Task<IResult<Speculum.Api.Telemetry.Models.SidecarTelemetrySample>> CollectTelemetryAsync(
            Speculum.Api.Telemetry.Models.SidecarTelemetryRequest request,
            CancellationToken ct = default)
            => Task.FromResult<IResult<Speculum.Api.Telemetry.Models.SidecarTelemetrySample>>(
                Result<Speculum.Api.Telemetry.Models.SidecarTelemetrySample>.Failure("not supported"));

        public Task<IResult<HostResourcesApplyOutcome>> ApplyHostResourcesAsync(
            long shmSizeBytes,
            bool raiseUlimits,
            long nofile,
            long nproc,
            CancellationToken ct = default)
            => Task.FromResult<IResult<HostResourcesApplyOutcome>>(
                Result<HostResourcesApplyOutcome>.Failure("not supported"));

        public Task<IResult<HostResourcesLiveStatus>> GetHostResourcesAsync(CancellationToken ct = default)
            => Task.FromResult<IResult<HostResourcesLiveStatus>>(
                Result<HostResourcesLiveStatus>.Failure("not supported"));

        public Task<IResult<ISessionConnection>> StartConnectionAsync(
            Guid sessionId,
            CancellationToken ct = default)
        {
            var connection = new FakeSessionConnection(sessionId, () => _connections.Remove(sessionId));
            _connections[sessionId] = connection;
            return Task.FromResult<IResult<ISessionConnection>>(Result<ISessionConnection>.Success(connection));
        }
    }

    private sealed class FakeSessionConnection : ISessionConnection
    {
        private readonly Action _onClose;
        private bool _open = true;
        private readonly Channel<Frame> _frames = Channel.CreateUnbounded<Frame>();
        private readonly Channel<DomDiff> _domDiffs = Channel.CreateUnbounded<DomDiff>();
        private readonly Channel<ConsoleOutput> _console = Channel.CreateUnbounded<ConsoleOutput>();
        private readonly Channel<SessionNotification> _notifications = Channel.CreateUnbounded<SessionNotification>();

        public FakeSessionConnection(Guid sessionId, Action onClose)
        {
            SessionId = sessionId;
            _onClose = onClose;
        }

        public Guid SessionId { get; }
        public bool IsOpen => _open;
        public SessionConfig? LastLaunchConfiguration { get; private set; }

        public Task<IResult<BrowserReadyInfo>> LaunchBrowserAsync(
            SessionConfig? configuration,
            CancellationToken ct = default)
        {
            LastLaunchConfiguration = configuration;
            return Task.FromResult<IResult<BrowserReadyInfo>>(Result<BrowserReadyInfo>.Success(new BrowserReadyInfo
            {
                Width = 800,
                Height = 600,
            }));
        }

        public Task<IResult> NavigateAsync(string url, CancellationToken ct = default)
            => Task.FromResult<IResult>(Result.Success());

        public Task<IResult> RefreshAsync(CancellationToken ct = default)
            => Task.FromResult<IResult>(Result.Success());

        public Task<IResult<CookieNormalizeStats>> RestoreProfileStateAsync(ProfileState state, CancellationToken ct = default)
            => Task.FromResult<IResult<CookieNormalizeStats>>(Result<CookieNormalizeStats>.Success(CookieNormalizeStats.Empty));

        public Task<IResult<SessionState>> ExportSessionStateAsync(CancellationToken ct = default)
            => Task.FromResult<IResult<SessionState>>(Result<SessionState>.Success(new SessionState()));

        public Task<IResult> StopBrowserAsync(CancellationToken ct = default)
            => Task.FromResult<IResult>(Result.Success());

        public Task<IResult> CloseAsync(CancellationToken ct = default)
        {
            _open = false;
            _onClose();
            return Task.FromResult<IResult>(Result.Success());
        }

        public Task<IResult<ResizeResult>> ResizeAsync(
            string requestId,
            int width,
            int height,
            DeviceProfile device,
            CancellationToken ct = default)
            => Task.FromResult<IResult<ResizeResult>>(Result<ResizeResult>.Failure("not implemented"));

        public Task<IResult<DiagProbeResult>> RequestDiagnosticsAsync(
            DiagProbeRequest request,
            CancellationToken ct = default)
            => Task.FromResult<IResult<DiagProbeResult>>(Result<DiagProbeResult>.Failure("not implemented"));

        public IResult<ChannelReader<Frame>> GetFrameReader()
            => Result<ChannelReader<Frame>>.Success(_frames.Reader);

        public IResult<ChannelReader<DomDiff>> GetDomDiffReader()
            => Result<ChannelReader<DomDiff>>.Success(_domDiffs.Reader);

        public IResult<ChannelReader<ConsoleOutput>> GetConsoleOutputReader()
            => Result<ChannelReader<ConsoleOutput>>.Success(_console.Reader);

        public Task<IResult<SessionStatus>> GetStatusAsync(CancellationToken ct = default)
            => Task.FromResult<IResult<SessionStatus>>(Result<SessionStatus>.Success(new SessionStatus
            {
                SessionId = SessionId.ToString("D"),
            }));

        public IResult<ChannelReader<SessionNotification>> GetNotificationReader()
            => Result<ChannelReader<SessionNotification>>.Success(_notifications.Reader);

        public void SetCameraPermissionHandler(Func<CancellationToken, Task<PermissionDecision>> handler) { }

        public void SetMicrophonePermissionHandler(Func<CancellationToken, Task<PermissionDecision>> handler) { }

        public IResult<Task> ConsumeVideoStreamingInputAsync(ChannelReader<VideoStreamingInput> channelReader)
            => Result<Task>.Success(Task.CompletedTask);

        public IResult<Task> ConsumeDomProjectionInputAsync(ChannelReader<DomProjectionInput> channelReader)
            => Result<Task>.Success(Task.CompletedTask);

        public Task<IResult<DomAsset>> GetDomAssetAsync(string hash, CancellationToken ct = default)
            => Task.FromResult<IResult<DomAsset>>(Result<DomAsset>.Failure("not implemented"));

        public IResult<Task> ConsumeConsoleInputAsync(ChannelReader<ConsoleInput> channelReader)
            => Result<Task>.Success(Task.CompletedTask);
    }
}
