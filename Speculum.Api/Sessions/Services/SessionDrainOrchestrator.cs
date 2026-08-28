using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Speculum.Api.Journal.Services.Contracts;
using Speculum.Api.Sessions.Events.Models;
using Speculum.Api.Sessions.Models;
using Speculum.Api.Sessions.Requests;
using Speculum.Api.Sessions.Services.Contracts;

namespace Speculum.Api.Sessions.Services;

/// <summary>
/// Prod drain: cancel starts, soft-stop live with Drain, ForceStop remainders after budget,
/// then a final sweep so raced starts/live sessions cannot survive Apply/shutdown.
/// </summary>
public sealed class SessionDrainOrchestrator : ISessionDrainOrchestrator
{
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly ILiveSessionService _liveSessions;
    private readonly ISessionBindingRegistry _bindings;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IJournalWriter _journal;
    private readonly ILogger<SessionDrainOrchestrator> _logger;
    private int _draining;

    public SessionDrainOrchestrator(
        ILiveSessionService liveSessions,
        ISessionBindingRegistry bindings,
        IServiceScopeFactory scopeFactory,
        IJournalWriter journal,
        ILogger<SessionDrainOrchestrator> logger)
    {
        _liveSessions = liveSessions;
        _bindings = bindings;
        _scopeFactory = scopeFactory;
        _journal = journal;
        _logger = logger;
    }

    public bool IsDraining => Volatile.Read(ref _draining) != 0;

    public async Task DrainAsync(SessionDrainRequest request, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentException.ThrowIfNullOrWhiteSpace(request.Trigger);

        var trigger = request.Trigger.Trim();
        var forceAfter = request.ForceAfter < TimeSpan.Zero ? TimeSpan.Zero : request.ForceAfter;

        await _gate.WaitAsync(ct).ConfigureAwait(false);
        Interlocked.Exchange(ref _draining, 1);

        var drainStarted = false;
        var sessionCount = 0;
        var forcedCount = 0;
        try
        {
            var cancelledStarts = _bindings.CancelAllStarts();
            var liveIds = SnapshotLiveIds();
            sessionCount = liveIds.Length + cancelledStarts;
            if (sessionCount == 0)
            {
                return;
            }

            _journal.Append(new DrainStarted
            {
                SessionCount = sessionCount,
                Trigger = trigger,
            });
            drainStarted = true;

            _logger.LogInformation(
                "Session drain started ({Trigger}): {Live} live, {Starting} starting cancelled.",
                trigger,
                liveIds.Length,
                cancelledStarts);

            if (liveIds.Length > 0)
            {
                forcedCount += await SoftThenForceAsync(liveIds, forceAfter, ct).ConfigureAwait(false);
            }

            // Catch starts that raced BeginStart after the first CancelAllStarts, and any
            // live leftovers still in the registry after soft/force.
            var racedStarts = _bindings.CancelAllStarts();
            if (racedStarts > 0)
            {
                sessionCount += racedStarts;
                _logger.LogInformation(
                    "Session drain ({Trigger}): cancelled {Count} raced start(s) in final sweep.",
                    trigger,
                    racedStarts);
            }

            var leftovers = SnapshotLiveIds();
            if (leftovers.Length > 0)
            {
                _logger.LogWarning(
                    "Session drain ({Trigger}): ForceStopping {Count} leftover session(s) in final sweep.",
                    trigger,
                    leftovers.Length);
                await StopManyAsync(leftovers, StopReason.ForceStop).ConfigureAwait(false);
                forcedCount += leftovers.Length;
            }
        }
        finally
        {
            if (drainStarted)
            {
                try
                {
                    _journal.Append(new DrainCompleted
                    {
                        SessionCount = sessionCount,
                        ForcedCount = forcedCount,
                        Trigger = trigger,
                    });
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Failed to journal Sessions.DrainCompleted ({Trigger}).", trigger);
                }

                _logger.LogInformation(
                    "Session drain completed ({Trigger}): forced={Forced}.",
                    trigger,
                    forcedCount);
            }

            Interlocked.Exchange(ref _draining, 0);
            _gate.Release();
        }
    }

    private async Task<int> SoftThenForceAsync(
        Guid[] liveIds,
        TimeSpan forceAfter,
        CancellationToken ct)
    {
        // Soft stops use CancellationToken.None so export/teardown finish even if the
        // Apply/shutdown token is cancelled — ForceStop still runs for remainders.
        var softAll = Task.WhenAll(
            liveIds.Select(id => StopOneAsync(id, StopReason.Drain, CancellationToken.None)));

        try
        {
            await softAll.WaitAsync(forceAfter, ct).ConfigureAwait(false);
            return 0;
        }
        catch (TimeoutException)
        {
            return await ForceRemainingAsync(softAll, "soft budget elapsed").ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            // Caller cancelled the wait — still ForceStop remainders, then propagate.
            await ForceRemainingAsync(softAll, "caller cancelled").ConfigureAwait(false);
            throw;
        }
    }

    private async Task<int> ForceRemainingAsync(Task softAll, string reason)
    {
        var remaining = SnapshotLiveIds();
        if (remaining.Length > 0)
        {
            _logger.LogWarning(
                "Session drain ForceStopping {Count} session(s) ({Reason}).",
                remaining.Length,
                reason);
            await StopManyAsync(remaining, StopReason.ForceStop).ConfigureAwait(false);
        }

        try
        {
            await softAll.ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Soft drain tasks completed with errors after ForceStop.");
        }

        return remaining.Length;
    }

    private Task StopManyAsync(IReadOnlyList<Guid> sessionIds, StopReason reason)
        => Task.WhenAll(sessionIds.Select(id => StopOneAsync(id, reason, CancellationToken.None)));

    private Guid[] SnapshotLiveIds()
        => _liveSessions.ListSnapshots()
            .Select(static s => s.SessionId)
            .Distinct()
            .ToArray();

    private async Task StopOneAsync(Guid sessionId, StopReason reason, CancellationToken ct)
    {
        // One scope per stop — EfSessionRepository/DbContext is not thread-safe across parallel stops.
        try
        {
            using var scope = _scopeFactory.CreateScope();
            var sessions = scope.ServiceProvider.GetRequiredService<ISessionService>();
            var stop = await sessions.StopSessionAsync(
                    new StopSession
                    {
                        SessionId = sessionId,
                        Reason = reason,
                    },
                    ct)
                .ConfigureAwait(false);
            if (stop.IsFailure)
            {
                _logger.LogWarning(
                    "Drain stop for session {SessionId} ({Reason}) failed: {Errors}",
                    sessionId,
                    reason.ToStableString(),
                    string.Join("; ", stop.Errors.Select(static e => e.Message)));
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(
                ex,
                "Drain stop for session {SessionId} ({Reason}) threw.",
                sessionId,
                reason.ToStableString());
        }
    }
}
