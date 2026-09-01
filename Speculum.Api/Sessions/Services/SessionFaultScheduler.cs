using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Speculum.Api.Sessions.Models;
using Speculum.Api.Sessions.Requests;
using Speculum.Api.Sessions.Services.Contracts;

namespace Speculum.Api.Sessions.Services;

/// <summary>
/// Fire-and-forget stop requests when a live browser connection is lost.
/// Mirrors <see cref="SessionCollector"/> scoping so stop runs outside the live registry lock.
/// </summary>
public sealed class SessionFaultScheduler : ISessionFaultScheduler
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<SessionFaultScheduler> _logger;

    public SessionFaultScheduler(
        IServiceScopeFactory scopeFactory,
        ILogger<SessionFaultScheduler> logger)
    {
        _scopeFactory = scopeFactory ?? throw new ArgumentNullException(nameof(scopeFactory));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public void RequestStop(Guid sessionId, StopReason reason)
    {
        _ = StopAsync(sessionId, reason);
    }

    private async Task StopAsync(Guid sessionId, StopReason reason)
    {
        try
        {
            using var scope = _scopeFactory.CreateScope();
            var sessions = scope.ServiceProvider.GetRequiredService<ISessionService>();
            var stop = await sessions.StopSessionAsync(new StopSession
                {
                    SessionId = sessionId,
                    Reason = reason,
                })
                .ConfigureAwait(false);
            if (stop.IsFailure)
            {
                _logger.LogWarning(
                    "Fault stop for session {SessionId} ({Reason}) failed: {Errors}",
                    sessionId,
                    reason.ToStableString(),
                    string.Join("; ", stop.Errors.Select(static e => e.Message)));
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(
                ex,
                "Fault stop for session {SessionId} ({Reason}) threw.",
                sessionId,
                reason.ToStableString());
        }
    }
}
