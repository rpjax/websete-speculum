using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Speculum.Api.Sessions.Services.Contracts;

namespace Speculum.Api.Sessions.Services;

/// <summary>
/// Graceful process shutdown: drain live sessions before the host tears down Journal.
/// Registered after Journal so <see cref="StopAsync"/> runs first (reverse stop order).
/// </summary>
public sealed class SessionDrainHostedService : IHostedService
{
    private readonly ISessionDrainOrchestrator _drain;
    private readonly ILogger<SessionDrainHostedService> _logger;

    public SessionDrainHostedService(
        ISessionDrainOrchestrator drain,
        ILogger<SessionDrainHostedService> logger)
    {
        _drain = drain;
        _logger = logger;
    }

    public Task StartAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    public async Task StopAsync(CancellationToken cancellationToken)
    {
        // Do not pass the host stopping token into soft-wait — a cancelled Delay would skip
        // ForceStop. Soft stops and ForceStop use CancellationToken.None internally; the
        // ForceAfter budget alone bounds shutdown drain duration.
        try
        {
            await _drain.DrainAsync(
                    new SessionDrainRequest(
                        SessionDrainTriggers.ShutdownTrigger,
                        SessionDrainTriggers.ShutdownForceAfter),
                    CancellationToken.None)
                .ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Shutdown session drain failed.");
        }
    }
}
