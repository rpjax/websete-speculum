using Aidan.Core.Patterns;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Speculum.Api.BrowserSessions.Requests;
using Speculum.Api.BrowserSessions.Services;
using Speculum.Api.BrowserSessions.Services.Contracts;

namespace Speculum.Api.Sessions.Tests;

public sealed class SessionCollectorTests
{
    [Fact]
    public async Task DetachedSession_TimesOutAndStops()
    {
        var lifecycle = new RecordingLifecycleEvents();
        var stopSignal = new TaskCompletionSource<Guid>(TaskCreationOptions.RunContinuationsAsynchronously);

        var services = new ServiceCollection();
        services.AddSingleton<ISessionLifecycleEvents>(lifecycle);
        services.AddSingleton<ISessionService>(new FakeSessionService(stopSignal));
        var provider = services.BuildServiceProvider();

        using var collector = new SessionCollector(
            provider.GetRequiredService<IServiceScopeFactory>(),
            lifecycle,
            Options.Create(SessionsTestHarness.Sessions(TimeSpan.FromMilliseconds(50))),
            NullLogger<SessionCollector>.Instance);

        var sessionId = Guid.NewGuid();
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
        services.AddSingleton<ISessionLifecycleEvents>(lifecycle);
        services.AddSingleton<ISessionService>(new FakeSessionService());
        var provider = services.BuildServiceProvider();

        using var collector = new SessionCollector(
            provider.GetRequiredService<IServiceScopeFactory>(),
            lifecycle,
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

    private sealed class RecordingLifecycleEvents : ISessionLifecycleEvents
    {
        public List<Guid> TimedOutIds { get; } = new();

        public void Starting(Guid sessionId) { }
        public void Started(Guid sessionId) { }
        public void Stopping(Guid sessionId) { }
        public void Stopped(Guid sessionId) { }
        public void TimedOut(Guid sessionId) => TimedOutIds.Add(sessionId);
        public void Aborted(Guid sessionId) { }
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
