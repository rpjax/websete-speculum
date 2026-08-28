using Microsoft.Extensions.Logging.Abstractions;
using Speculum.Api.Sessions.Services;
using Speculum.Api.Sessions.Services.Contracts;

namespace Speculum.Api.Sessions.Tests;

public sealed class SessionDrainHostedServiceTests
{
    [Fact]
    public async Task StopAsync_DrainsWithShutdownTrigger_AndIgnoresCallerToken()
    {
        using var cancelled = new CancellationTokenSource();
        cancelled.Cancel();
        var drain = new RecordingDrain();
        var hosted = new SessionDrainHostedService(
            drain,
            NullLogger<SessionDrainHostedService>.Instance);

        await hosted.StopAsync(cancelled.Token);

        Assert.Single(drain.Calls);
        Assert.Equal(SessionDrainTriggers.ShutdownTrigger, drain.Calls[0].Trigger);
        Assert.Equal(SessionDrainTriggers.ShutdownForceAfter, drain.Calls[0].ForceAfter);
        Assert.False(drain.Calls[0].Token.CanBeCanceled);
    }

    [Fact]
    public async Task StopAsync_WhenDrainThrows_DoesNotPropagate()
    {
        var drain = new RecordingDrain { ThrowOnDrain = true };
        var hosted = new SessionDrainHostedService(
            drain,
            NullLogger<SessionDrainHostedService>.Instance);

        await hosted.StopAsync(CancellationToken.None);

        Assert.Single(drain.Calls);
    }

    private sealed class RecordingDrain : ISessionDrainOrchestrator
    {
        public bool IsDraining => false;
        public bool ThrowOnDrain { get; init; }
        public List<(string Trigger, TimeSpan ForceAfter, CancellationToken Token)> Calls { get; } = [];

        public Task DrainAsync(SessionDrainRequest request, CancellationToken ct = default)
        {
            Calls.Add((request.Trigger, request.ForceAfter, ct));
            if (ThrowOnDrain)
            {
                throw new InvalidOperationException("drain failed");
            }

            return Task.CompletedTask;
        }
    }
}
