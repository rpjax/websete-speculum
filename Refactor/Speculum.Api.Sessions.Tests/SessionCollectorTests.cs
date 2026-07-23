using Aidan.Core.Errors;
using Aidan.Core.Patterns;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Speculum.Api.Sessions.Aggregates;
using Speculum.Api.Sessions.Events.Services.Contracts;
using Speculum.Api.Sessions.Requests;
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
            Options.Create(SessionsTestHarness.Sessions(TimeSpan.FromMilliseconds(50))),
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
            Options.Create(SessionsTestHarness.Sessions(TimeSpan.FromMilliseconds(100))),
            NullLogger<SessionCollector>.Instance);

        var sessionId = Guid.NewGuid();
        collector.Watch(sessionId);
        collector.AddRef(sessionId);
        collector.Release(sessionId);
        collector.AddRef(sessionId);

        Thread.Sleep(150);
        Assert.Empty(lifecycle.TimedOutIds);
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

        public ISessionLifecycleEvents ForSessionLifecycle(Session session)
            => ForSessionLifecycle(session.Id, session.ProfileId);

        public ISessionStartEvents ForSessionStart(Session session)
            => ForSessionStart(session.Id, session.ProfileId);

        public ISessionStopEvents ForSessionStop(Session session)
            => ForSessionStop(session.Id, session.ProfileId);
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
        public void Stopping() { }
        public void Stopped() { }
        public void TimedOut() => TimedOutIds.Add(_sessionId);
        public void Aborted() { }
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
    }

    private sealed class FakeSessionService : ISessionService
    {
        private readonly TaskCompletionSource<Guid>? _stopSignal;

        public FakeSessionService(TaskCompletionSource<Guid>? stopSignal = null)
            => _stopSignal = stopSignal;

        public Task<IResult<Guid>> StartSessionAsync(
            StartSession request,
            CancellationToken ct = default)
            => Task.FromResult<IResult<Guid>>(Result<Guid>.Success(Guid.NewGuid()));

        public Task<IResult> StopSessionAsync(
            StopSession request,
            CancellationToken ct = default)
        {
            _stopSignal?.TrySetResult(request.SessionId);
            return Task.FromResult<IResult>(Result.Success());
        }
    }
}
