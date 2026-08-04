using Aidan.Core.Errors;
using Aidan.Core.Patterns;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Speculum.Api.Sessions.Aggregates;
using Speculum.Api.Sessions.Events.Models;
using Speculum.Api.Sessions.Events.Services.Contracts;
using Speculum.Api.Sessions.Models;
using Speculum.Api.Sessions.Requests;
using Speculum.Api.Sessions.Responses;
using Speculum.Api.Sessions.Services;
using Speculum.Api.Sessions.Services.Contracts;

namespace Speculum.Api.Sessions.Tests;

public sealed class SessionCollectorTests
{
    [Fact]
    public async Task DetachedSession_TimesOutAndStops()
    {
        var lifecycle = new RecordingLifecycleEvents();
        var stopSignal = new TaskCompletionSource<Guid>(TaskCreationOptions.RunContinuationsAsynchronously);
        var sessionId = Guid.NewGuid();
        var profileId = Guid.NewGuid();

        var services = new ServiceCollection();
        services.AddSingleton<ISessionService>(new FakeSessionService(stopSignal));
        services.AddSingleton<ISessionRepository>(new InMemorySessionRepository(
            Session.Create(sessionId, profileId)));
        var provider = services.BuildServiceProvider();

        using var collector = new SessionCollector(
            provider.GetRequiredService<IServiceScopeFactory>(),
            new RecordingEventsFactory(lifecycle),
            SessionsTestHarness.Configuration(SessionsTestHarness.Sessions(TimeSpan.FromMilliseconds(50))),
            NullLogger<SessionCollector>.Instance);

        collector.Watch(sessionId);

        var stoppedId = await stopSignal.Task.WaitAsync(TimeSpan.FromSeconds(2));
        Assert.Equal(sessionId, stoppedId);
        Assert.Contains(sessionId, lifecycle.TimedOutIds);
    }

    [Fact]
    public void AddRef_CancelsDetachedTimer()
    {
        var lifecycle = new RecordingLifecycleEvents();
        var services = new ServiceCollection();
        services.AddSingleton<ISessionService>(new FakeSessionService());
        services.AddSingleton<ISessionRepository>(new InMemorySessionRepository());
        var provider = services.BuildServiceProvider();

        using var collector = new SessionCollector(
            provider.GetRequiredService<IServiceScopeFactory>(),
            new RecordingEventsFactory(lifecycle),
            SessionsTestHarness.Configuration(SessionsTestHarness.Sessions(TimeSpan.FromMilliseconds(100))),
            NullLogger<SessionCollector>.Instance);

        var sessionId = Guid.NewGuid();
        collector.Watch(sessionId);
        collector.AddRef(sessionId);
        collector.Release(sessionId);
        collector.AddRef(sessionId);

        Thread.Sleep(150);
        Assert.Empty(lifecycle.TimedOutIds);
    }

    [Fact]
    public async Task TimedOut_DoesNotStopAlreadyStoppedSession()
    {
        var lifecycle = new RecordingLifecycleEvents();
        var stopSignal = new TaskCompletionSource<Guid>(TaskCreationOptions.RunContinuationsAsynchronously);
        var sessionId = Guid.NewGuid();
        var profileId = Guid.NewGuid();
        var session = Session.Create(sessionId, profileId);
        session.MarkStopped(StopReason.UserStop);

        var services = new ServiceCollection();
        services.AddSingleton<ISessionService>(new FakeSessionService(stopSignal));
        services.AddSingleton<ISessionRepository>(new InMemorySessionRepository(session));
        var provider = services.BuildServiceProvider();

        using var collector = new SessionCollector(
            provider.GetRequiredService<IServiceScopeFactory>(),
            new RecordingEventsFactory(lifecycle),
            SessionsTestHarness.Configuration(SessionsTestHarness.Sessions(TimeSpan.FromMilliseconds(30))),
            NullLogger<SessionCollector>.Instance);

        collector.Watch(sessionId);
        await Task.Delay(80);

        Assert.Empty(lifecycle.TimedOutIds);
        Assert.False(stopSignal.Task.IsCompleted);
    }

    [Fact]
    public async Task TimedOut_DoesNotFireAfterReattachClaimRace()
    {
        var lifecycle = new RecordingLifecycleEvents();
        var stopSignal = new TaskCompletionSource<Guid>(TaskCreationOptions.RunContinuationsAsynchronously);
        var sessionId = Guid.NewGuid();
        var profileId = Guid.NewGuid();

        var services = new ServiceCollection();
        services.AddSingleton<ISessionService>(new FakeSessionService(stopSignal));
        services.AddSingleton<ISessionRepository>(new InMemorySessionRepository(
            Session.Create(sessionId, profileId)));
        var provider = services.BuildServiceProvider();

        using var collector = new SessionCollector(
            provider.GetRequiredService<IServiceScopeFactory>(),
            new RecordingEventsFactory(lifecycle),
            SessionsTestHarness.Configuration(SessionsTestHarness.Sessions(TimeSpan.FromMilliseconds(40))),
            NullLogger<SessionCollector>.Instance);

        collector.Watch(sessionId);
        await Task.Delay(20);
        collector.AddRef(sessionId);
        await Task.Delay(80);

        Assert.Empty(lifecycle.TimedOutIds);
        Assert.False(stopSignal.Task.IsCompleted);
    }

    [Fact]
    public async Task TimedOut_ReArmsWhenStopFails()
    {
        var lifecycle = new RecordingLifecycleEvents();
        var sessionId = Guid.NewGuid();
        var profileId = Guid.NewGuid();
        var failingStops = new FailingSessionService();

        var services = new ServiceCollection();
        services.AddSingleton<ISessionService>(failingStops);
        services.AddSingleton<ISessionRepository>(new InMemorySessionRepository(
            Session.Create(sessionId, profileId)));
        var provider = services.BuildServiceProvider();

        using var collector = new SessionCollector(
            provider.GetRequiredService<IServiceScopeFactory>(),
            new RecordingEventsFactory(lifecycle),
            SessionsTestHarness.Configuration(SessionsTestHarness.Sessions(TimeSpan.FromMilliseconds(30))),
            NullLogger<SessionCollector>.Instance);

        collector.Watch(sessionId);

        var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(2);
        while (failingStops.StopAttempts < 1 && DateTime.UtcNow < deadline)
            await Task.Delay(10);
        Assert.True(failingStops.StopAttempts >= 1);

        failingStops.ShouldFail = false;
        var stopSignal = new TaskCompletionSource<Guid>(TaskCreationOptions.RunContinuationsAsynchronously);
        failingStops.StopSignal = stopSignal;

        var stoppedId = await stopSignal.Task.WaitAsync(TimeSpan.FromSeconds(2));
        Assert.Equal(sessionId, stoppedId);
        Assert.Contains(sessionId, lifecycle.TimedOutIds);
    }

    private sealed class RecordingEventsFactory : ISessionEventsFactory
    {
        private readonly RecordingLifecycleEvents _lifecycle;

        public RecordingEventsFactory(RecordingLifecycleEvents lifecycle) => _lifecycle = lifecycle;

        public ISessionLifecycleEvents ForSessionLifecycle(Guid sessionId, Guid profileId)
            => _lifecycle.Bind(sessionId);

        public ISessionStartEvents ForSessionStart(Guid sessionId, Guid profileId)
            => throw new NotSupportedException();

        public ISessionStopEvents ForSessionStop(Guid sessionId, Guid profileId)
            => throw new NotSupportedException();

        public ISessionLiveEvents ForSessionLive(Guid sessionId, Guid profileId)
            => throw new NotSupportedException();

        public ISessionLifecycleEvents ForSessionLifecycle(Session session)
            => ForSessionLifecycle(session.Id, session.ProfileId);

        public ISessionStartEvents ForSessionStart(Session session)
            => ForSessionStart(session.Id, session.ProfileId);

        public ISessionStopEvents ForSessionStop(Session session)
            => ForSessionStop(session.Id, session.ProfileId);

        public ISessionLiveEvents ForSessionLive(Session session)
            => ForSessionLive(session.Id, session.ProfileId);
    }

    private sealed class RecordingLifecycleEvents : ISessionLifecycleEvents
    {
        private Guid _sessionId;

        public List<Guid> TimedOutIds { get; } = new();

        public ISessionLifecycleEvents Bind(Guid sessionId)
        {
            _sessionId = sessionId;
            return this;
        }

        public void Starting() { }
        public void Started() { }
        public void Stopping(StopReason reason) { }
        public void Stopped(StopReason reason) { }
        public void TimedOut(StopReason reason) => TimedOutIds.Add(_sessionId);
        public void Aborted(StopReason reason, JournalError[]? errors = null) { }
    }

    private sealed class InMemorySessionRepository : ISessionRepository
    {
        private readonly Dictionary<Guid, Session> _sessions = new();

        public InMemorySessionRepository(params Session[] sessions)
        {
            foreach (var session in sessions)
            {
                _sessions[session.Id] = session;
            }
        }

        public Task<Session?> LoadAsync(Guid sessionId, CancellationToken ct = default)
            => Task.FromResult(_sessions.GetValueOrDefault(sessionId));

        public Task SaveAsync(Session session, CancellationToken ct = default)
        {
            _sessions[session.Id] = session;
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

    private sealed class FakeSessionService : ISessionService
    {
        private readonly TaskCompletionSource<Guid>? _stopSignal;

        public FakeSessionService(TaskCompletionSource<Guid>? stopSignal = null)
            => _stopSignal = stopSignal;

        public Task<IResult<StartSessionResponse>> StartSessionAsync(
            StartSession request,
            CancellationToken ct = default)
            => Task.FromResult<IResult<StartSessionResponse>>(Result<StartSessionResponse>.Success(
                new StartSessionResponse
                {
                    SessionId = Guid.NewGuid(),
                    Token = "test-token",
                }));

        public Task<IResult> StopSessionAsync(
            StopSession request,
            CancellationToken ct = default)
        {
            _stopSignal?.TrySetResult(request.SessionId);
            return Task.FromResult<IResult>(Result.Success());
        }
    }

    private sealed class FailingSessionService : ISessionService
    {
        public bool ShouldFail { get; set; } = true;
        public int StopAttempts { get; private set; }
        public TaskCompletionSource<Guid>? StopSignal { get; set; }

        public Task<IResult<StartSessionResponse>> StartSessionAsync(
            StartSession request,
            CancellationToken ct = default)
            => Task.FromResult<IResult<StartSessionResponse>>(Result<StartSessionResponse>.Success(
                new StartSessionResponse
                {
                    SessionId = Guid.NewGuid(),
                    Token = "test-token",
                }));

        public Task<IResult> StopSessionAsync(
            StopSession request,
            CancellationToken ct = default)
        {
            StopAttempts++;
            if (ShouldFail)
            {
                return Task.FromResult<IResult>(Result.Failure("stop failed"));
            }

            StopSignal?.TrySetResult(request.SessionId);
            return Task.FromResult<IResult>(Result.Success());
        }
    }
}
