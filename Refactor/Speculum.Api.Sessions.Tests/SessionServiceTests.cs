using System.Diagnostics.CodeAnalysis;
using System.Threading.Channels;
using Aidan.Core.Errors;
using Aidan.Core.Patterns;
using Microsoft.Extensions.Options;
using Speculum.Api.BrowserClients;
using Speculum.Api.Profiles.Aggregates;
using Speculum.Api.Profiles.Services.Contracts;
using Speculum.Api.Sessions.Aggregates;
using Speculum.Api.Sessions.Events.Services.Contracts;
using Speculum.Api.Sessions.Models;
using Speculum.Api.Sessions.Requests;
using Speculum.Api.Sessions.Services;
using Speculum.Api.Sessions.Services.Contracts;

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
        var collector = new NoOpCollector();
        var browser = new FakeBrowserClient();
        var pipes = new NoOpPipeService();

        var service = new SessionService(
            profiles,
            sessions,
            slots,
            collector,
            pipes,
            new FixedInitialUrlResolver("https://example.test/"),
            new NoOpSessionEventsFactory(),
            browser);

        var result = await service.StartSessionAsync(new StartSession
        {
            ProfileId = profileId,
            Configuration = new SessionConfig
            {
                Resolution = new ScreenResolution { Width = 800, Height = 600 },
            },
        });

        Assert.True(result.IsSuccess);
        var loaded = await sessions.LoadAsync(result.Value);
        Assert.NotNull(loaded);
        Assert.Equal(profileId, loaded.ProfileId);
    }

    [Fact]
    public async Task StartSession_ProfileNotFound_Fails()
    {
        var service = new SessionService(
            new InMemoryProfileRepository(),
            new InMemorySessionRepository(),
            new SessionSlotRegistry(
                Options.Create(SessionsTestHarness.ResourceManagement())),
            new NoOpCollector(),
            new NoOpPipeService(),
            new FixedInitialUrlResolver("https://example.test/"),
            new NoOpSessionEventsFactory(),
            new FakeBrowserClient());

        var result = await service.StartSessionAsync(new StartSession
        {
            ProfileId = Guid.NewGuid(),
            Configuration = new SessionConfig
            {
                Resolution = new ScreenResolution { Width = 800, Height = 600 },
            },
        });

        Assert.True(result.IsFailure);
    }

    private sealed class FixedInitialUrlResolver : IInitialUrlResolver
    {
        private readonly string _url;

        public FixedInitialUrlResolver(string url) => _url = url;

        public IResult<string> Resolve(Guid sessionId, Guid profileId)
            => Result<string>.Success(_url);
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

        public Task<Session?> LoadAsync(Guid sessionId, CancellationToken ct = default)
            => Task.FromResult(_sessions.GetValueOrDefault(sessionId));

        public Task SaveAsync(Session session, CancellationToken ct = default)
        {
            _sessions[session.Id] = session;
            return Task.CompletedTask;
        }
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

    private sealed class NoOpCollector : ISessionCollector
    {
        public void Watch(Guid sessionId) { }
        public void AddRef(Guid sessionId) { }
        public void Release(Guid sessionId) { }
        public void Unwatch(Guid sessionId) { }
    }

    private sealed class NoOpPipeService : ISessionPipeService
    {
        public IResult<ISessionPipe> OpenPipe(Guid sessionId, Guid pipeId)
            => Result<ISessionPipe>.Failure("not implemented");

        public IResult ClosePipe(Guid pipeId) => Result.Success();
        public void CloseAllSessionPipes(Guid sessionId) { }
        public bool TryGetPipe(Guid pipeId, [NotNullWhen(true)] out ISessionPipe? pipe)
        {
            pipe = null;
            return false;
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
            => Result<ChannelReader<Frame>>.Success(Channel.CreateUnbounded<Frame>().Reader);

        public IResult<ChannelReader<ConsoleOutput>> GetConsoleOutputReader()
            => Result<ChannelReader<ConsoleOutput>>.Success(Channel.CreateUnbounded<ConsoleOutput>().Reader);

        public IResult<ChannelReader<SessionStatus>> GetStatusReader()
            => Result<ChannelReader<SessionStatus>>.Success(Channel.CreateUnbounded<SessionStatus>().Reader);

        public IResult<ChannelReader<SessionNotification>> GetNotificationReader()
            => Result<ChannelReader<SessionNotification>>.Success(Channel.CreateUnbounded<SessionNotification>().Reader);

        public void SetCameraPermissionHandler(Func<CancellationToken, Task<PermissionDecision>> handler) { }

        public void SetMicrophonePermissionHandler(Func<CancellationToken, Task<PermissionDecision>> handler) { }

        public IResult<Task> ConsumeUserInputAsync(ChannelReader<string> channelReader)
            => Result<Task>.Success(Task.CompletedTask);

        public IResult<Task> ConsumeConsoleInputAsync(ChannelReader<ConsoleInput> channelReader)
            => Result<Task>.Success(Task.CompletedTask);
    }
}
