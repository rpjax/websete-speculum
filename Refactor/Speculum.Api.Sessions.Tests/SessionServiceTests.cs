using System.Diagnostics.CodeAnalysis;
using System.Threading.Channels;
using Aidan.Core.Errors;
using Aidan.Core.Patterns;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Speculum.Api.BrowserClients;
using Speculum.Api.Configurations.Models.Sessions;
using Speculum.Api.Profiles.Aggregates;
using Speculum.Api.Profiles.Services.Contracts;
using Speculum.Api.Sessions.Aggregates;
using Speculum.Api.Sessions.Events.Services.Contracts;
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
        var slots = new SessionSlotRegistry(
            Options.Create(SessionsTestHarness.ResourceManagement()));
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
            browser,
            new FixedSessionTokenGenerator("test-auth-token"),
            new ScopedMutex());

        var result = await service.StartSessionAsync(new StartSession
        {
            ProfileId = profileId,
            Path = "/",
            Query = "",
            Configuration = new SessionConfig
            {
                Resolution = new ScreenResolution { Width = 800, Height = 600 },
            },
        });

        Assert.True(result.IsSuccess);
        Assert.Equal("test-auth-token", result.Value.Token);
        var loaded = await sessions.LoadAsync(result.Value.SessionId);
        Assert.NotNull(loaded);
        Assert.Equal(profileId, loaded.ProfileId);
        Assert.Equal("test-auth-token", loaded.AuthToken);
        Assert.True(live.TryGet(result.Value.SessionId, out _));
        Assert.Contains(result.Value.SessionId, collector.Watched);
    }

    [Fact]
    public async Task StopSession_ReleasesLiveContextAndConnection()
    {
        var profileId = Guid.NewGuid();
        var profiles = new InMemoryProfileRepository();
        await profiles.SaveAsync(Profile.Create(profileId));

        var sessions = new InMemorySessionRepository();
        var slots = new SessionSlotRegistry(
            Options.Create(SessionsTestHarness.ResourceManagement()));
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
            browser,
            new FixedSessionTokenGenerator("tok"),
            new ScopedMutex());

        var started = await service.StartSessionAsync(new StartSession
        {
            ProfileId = profileId,
            Path = "/",
            Query = "",
            Configuration = new SessionConfig
            {
                Resolution = new ScreenResolution { Width = 800, Height = 600 },
            },
        });
        Assert.True(started.IsSuccess);
        var sessionId = started.Value.SessionId;
        Assert.True(live.TryGet(sessionId, out var handle));
        Assert.True(handle!.Attach().IsSuccess);

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
        var slots = new SessionSlotRegistry(
            Options.Create(SessionsTestHarness.ResourceManagement()));
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
            browser,
            new FixedSessionTokenGenerator("tok"),
            new ScopedMutex());

        var result = await service.StartSessionAsync(new StartSession
        {
            ProfileId = profileId,
            Path = "/",
            Query = "",
            Configuration = new SessionConfig
            {
                Resolution = new ScreenResolution { Width = 800, Height = 600 },
            },
        });

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
            new SessionSlotRegistry(
                Options.Create(SessionsTestHarness.ResourceManagement())),
            collector,
            live,
            urls,
            new NoOpSessionEventsFactory(),
            browser,
            new FixedSessionTokenGenerator("unused"),
            new ScopedMutex());

        var result = await service.StartSessionAsync(new StartSession
        {
            ProfileId = Guid.NewGuid(),
            Path = "/",
            Query = "",
            Configuration = new SessionConfig
            {
                Resolution = new ScreenResolution { Width = 800, Height = 600 },
            },
        });

        Assert.True(result.IsFailure);
    }

    private static LiveSessionService CreateLiveSessionService(
        IUrlResolver urls,
        ISessionCollector collector)
    {
        return new LiveSessionService(
            collector,
            urls,
            Options.Create(new SessionsConfiguration
            {
                IsJsBridgeEnabled = true,
                InputMultiplexingPolicy = new InputMultiplexingPolicy
                {
                    Access = InputAccessPolicy.Shared,
                },
            }),
            new ScopedMutex());
    }

    private sealed class FixedUrlResolver(string url) : IUrlResolver
    {
        public IResult<string> Resolve(string path, string query)
            => Result<string>.Success(url);
    }

    private sealed class FixedSessionTokenGenerator(string token) : ISessionTokenGenerator
    {
        public string GetRandom() => token;
    }

    private sealed class NoOpSessionEventsFactory : ISessionEventsFactory
    {
        public ISessionLifecycleEvents ForSessionLifecycle(Guid sessionId, Guid profileId)
            => new NoOpLifecycleEvents();

        public ISessionStartEvents ForSessionStart(Guid sessionId, Guid profileId)
            => new NoOpStartEvents();

        public ISessionStopEvents ForSessionStop(Guid sessionId, Guid profileId)
            => new NoOpStopEvents();

        public ISessionLifecycleEvents ForSessionLifecycle(Session session)
            => ForSessionLifecycle(session.Id, session.ProfileId);

        public ISessionStartEvents ForSessionStart(Session session)
            => ForSessionStart(session.Id, session.ProfileId);

        public ISessionStopEvents ForSessionStop(Session session)
            => ForSessionStop(session.Id, session.ProfileId);
    }

    private sealed class NoOpLifecycleEvents : ISessionLifecycleEvents
    {
        public void Starting() { }
        public void Started() { }
        public void Stopping() { }
        public void Stopped() { }
        public void TimedOut() { }
        public void Aborted() { }
    }

    private sealed class NoOpStartEvents : ISessionStartEvents
    {
        public void SlotAcquired() { }
        public void ConnectionStarted() { }
        public void BrowserLaunched() { }
        public void ProfileStateRestored() { }
        public void InitialUrlResolved(string url) { }
        public void InitialNavigationCompleted() { }
        public void ProfileNotFound() { }
        public void NoSlotAvailable() { }
        public void ConnectionStartFailed(Error[] errors) { }
        public void LaunchBrowserFailed(Error[] errors) { }
        public void RestoreProfileStateFailed(Error[] errors) { }
        public void InitialUrlResolveFailed(Error[] errors) { }
        public void InitialNavigationFailed(Error[] errors) { }
    }

    private sealed class NoOpStopEvents : ISessionStopEvents
    {
        public void SessionStatePersisted() { }
        public void PersistSkippedNoConnection() { }
        public void PersistSkippedProfileNotFound() { }
        public void ExportSessionStateFailed(Error[] errors) { }
        public void CloseBrowserFailed(Error[] errors) { }
        public void CloseConnectionFailed(Error[] errors) { }
        public void BrowserClosed() { }
        public void ConnectionClosed() { }
        public void SlotReleased() { }
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

    private sealed class FailingLiveSessionService : ILiveSessionService
    {
        public IResult<ILiveSession> Create(Guid sessionId, ISessionConnection connection)
            => Result<ILiveSession>.Failure("live create failed");

        public bool TryGet(Guid sessionId, [NotNullWhen(true)] out ILiveSession? session)
        {
            session = null;
            return false;
        }

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
    }

    private sealed class FakeBrowserClient : IBrowserClient
    {
        private readonly Dictionary<Guid, FakeSessionConnection> _connections = new();

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
        private readonly Channel<ConsoleOutput> _console = Channel.CreateUnbounded<ConsoleOutput>();
        private readonly Channel<SessionNotification> _notifications = Channel.CreateUnbounded<SessionNotification>();

        public FakeSessionConnection(Guid sessionId, Action onClose)
        {
            SessionId = sessionId;
            _onClose = onClose;
        }

        public Guid SessionId { get; }
        public bool IsOpen => _open;

        public Task<IResult<BrowserReadyInfo>> LaunchBrowserAsync(
            SessionConfig? configuration,
            CancellationToken ct = default)
            => Task.FromResult<IResult<BrowserReadyInfo>>(Result<BrowserReadyInfo>.Success(new BrowserReadyInfo
            {
                Width = 800,
                Height = 600,
            }));

        public Task<IResult> NavigateAsync(string url, CancellationToken ct = default)
            => Task.FromResult<IResult>(Result.Success());

        public Task<IResult> RefreshAsync(CancellationToken ct = default)
            => Task.FromResult<IResult>(Result.Success());

        public Task<IResult> RestoreProfileStateAsync(ProfileState state, CancellationToken ct = default)
            => Task.FromResult<IResult>(Result.Success());

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

        public IResult<Task> ConsumeUserInputAsync(ChannelReader<string> channelReader)
            => Result<Task>.Success(Task.CompletedTask);

        public IResult<Task> ConsumeConsoleInputAsync(ChannelReader<ConsoleInput> channelReader)
            => Result<Task>.Success(Task.CompletedTask);
    }
}
