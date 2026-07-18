using Aidan.Core.Patterns;
using Speculum.Api.BrowserClients;
using Speculum.Api.BrowserProfiles.Services.Contracts;
using Speculum.Api.BrowserSessions.Aggregates;
using Speculum.Api.BrowserSessions.Models;
using Speculum.Api.BrowserSessions.Requests;
using Speculum.Api.BrowserSessions.Services.Contracts;

namespace Speculum.Api.BrowserSessions.Services;

public partial class SessionService : ISessionService
{
    private readonly IProfileRepository _profiles;
    private readonly ISessionRepository _sessions;
    private readonly ISessionSlotRegistry _slotRegistry;
    private readonly ISessionCollector _sessionCollector;
    private readonly ISessionPipeService _pipes;
    private readonly IInitialUrlResolver _initialUrls;
    private readonly ISessionLifecycleEvents _lifecycleEvents;
    private readonly ISessionStartEvents _startEvents;
    private readonly ISessionStopEvents _stopEvents;
    private readonly IBrowserClient _browserClient;

    public SessionService(
        IProfileRepository profiles,
        ISessionRepository sessions,
        ISessionSlotRegistry slotRegistry,
        ISessionCollector sessionCollector,
        ISessionPipeService pipes,
        IInitialUrlResolver initialUrls,
        ISessionLifecycleEvents lifecycleEvents,
        ISessionStartEvents startEvents,
        ISessionStopEvents stopEvents,
        IBrowserClient browserClient)
    {
        _profiles = profiles;
        _sessions = sessions;
        _slotRegistry = slotRegistry;
        _sessionCollector = sessionCollector;
        _pipes = pipes;
        _initialUrls = initialUrls;
        _lifecycleEvents = lifecycleEvents;
        _startEvents = startEvents;
        _stopEvents = stopEvents;
        _browserClient = browserClient;
    }

    public async Task<IResult<Guid>> StartSessionAsync(
        StartSession request,
        CancellationToken ct = default)
    {
        var sessionId = Guid.NewGuid();

        var profile = await _profiles.LoadAsync(request.ProfileId, ct);
        if (profile is null)
        {
            _startEvents.ProfileNotFound(sessionId, request.ProfileId);
            return Result<Guid>.Failure("Profile not found");
        }

        if (!_slotRegistry.TryAquire(sessionId))
        {
            _startEvents.NoSlotAvailable(sessionId);
            return Result<Guid>.Failure("No session slot available");
        }

        _startEvents.SlotAcquired(sessionId);
        _lifecycleEvents.Starting(sessionId);

        try
        {
            var connectionResult = await _browserClient.StartConnectionAsync(sessionId, ct);
            if (connectionResult.IsFailure)
            {
                _startEvents.ConnectionStartFailed(sessionId, connectionResult.Errors.ToArray());
                return await AbortStartAsync(sessionId, connectionResult, ct);
            }

            _startEvents.ConnectionStarted(sessionId);
            var connection = connectionResult.Value;

            var launchResult = await connection.LaunchBrowserAsync(request.Configuration, ct);
            if (launchResult.IsFailure)
            {
                _startEvents.LaunchBrowserFailed(sessionId, launchResult.Errors.ToArray());
                return await AbortStartAsync(sessionId, launchResult, ct);
            }

            _startEvents.BrowserLaunched(sessionId);

            var restoreResult = await connection.RestoreProfileStateAsync(profile.State, ct);
            if (restoreResult.IsFailure)
            {
                _startEvents.RestoreProfileStateFailed(sessionId, restoreResult.Errors.ToArray());
                return await AbortStartAsync(sessionId, restoreResult, ct);
            }

            _startEvents.ProfileStateRestored(sessionId);

            var urlResult = _initialUrls.Resolve(sessionId, request.ProfileId);
            if (urlResult.IsFailure)
            {
                _startEvents.InitialUrlResolveFailed(sessionId, urlResult.Errors.ToArray());
                return await AbortStartAsync(sessionId, urlResult, ct);
            }

            _startEvents.InitialUrlResolved(sessionId, urlResult.Value);

            var navigationResult = await connection.NavigateAsync(urlResult.Value, ct);
            if (navigationResult.IsFailure)
            {
                _startEvents.InitialNavigationFailed(sessionId, navigationResult.Errors.ToArray());
                return await AbortStartAsync(sessionId, navigationResult, ct);
            }

            _startEvents.InitialNavigationCompleted(sessionId);

            await _sessions.SaveAsync(Session.Create(sessionId, request.ProfileId), ct);

            _sessionCollector.Watch(sessionId);
            _lifecycleEvents.Started(sessionId);
            return Result<Guid>.Success(sessionId);
        }
        catch
        {
            await TearDownLiveResourcesAsync(sessionId, ct, emitStopEvents: false);
            _lifecycleEvents.Aborted(sessionId);
            throw;
        }
    }

    public async Task<IResult> StopSessionAsync(
        StopSession request,
        CancellationToken ct = default)
    {
        var sessionId = request.SessionId;
        var session = await _sessions.LoadAsync(sessionId, ct);

        if (session is null)
        {
            return Result.Failure("Session not found");
        }

        if (session.State is LifecycleState.Stopped or LifecycleState.Aborted)
        {
            return Result.Success();
        }

        _lifecycleEvents.Stopping(sessionId);

        await TryPersistSessionStateAsync(session, ct);

        session.MarkStopped();
        await _sessions.SaveAsync(session, ct);

        await TearDownLiveResourcesAsync(sessionId, ct, emitStopEvents: true);

        _lifecycleEvents.Stopped(sessionId);
        return Result.Success();
    }

    private async Task<IResult<Guid>> AbortStartAsync(
        Guid sessionId,
        IResult failed,
        CancellationToken ct)
    {
        await TearDownLiveResourcesAsync(sessionId, ct, emitStopEvents: false);
        _lifecycleEvents.Aborted(sessionId);
        return Result<Guid>.Failure(failed.Errors.ToArray());
    }

    private async Task TryPersistSessionStateAsync(Session session, CancellationToken ct)
    {
        var sessionId = session.Id;

        if (!_browserClient.TryGetConnection(sessionId, out var connection))
        {
            _stopEvents.PersistSkippedNoConnection(sessionId);
            return;
        }

        var profile = await _profiles.LoadAsync(session.ProfileId, ct);
        if (profile is null)
        {
            _stopEvents.PersistSkippedProfileNotFound(sessionId, session.ProfileId);
            return;
        }

        var exportResult = await connection.ExportSessionStateAsync(ct);
        if (exportResult.IsFailure)
        {
            _stopEvents.ExportSessionStateFailed(sessionId, exportResult.Errors.ToArray());
            return;
        }

        profile.ApplySessionExport(exportResult.Value);
        await _profiles.SaveAsync(profile, ct);
        _stopEvents.SessionStatePersisted(sessionId);
    }

    private async Task TearDownLiveResourcesAsync(
        Guid sessionId,
        CancellationToken ct,
        bool emitStopEvents)
    {
        _pipes.CloseAllSessionPipes(sessionId);
        _sessionCollector.Unwatch(sessionId);

        if (_browserClient.TryGetConnection(sessionId, out var connection))
        {
            var stopBrowserResult = await connection.StopBrowserAsync(ct);
            if (emitStopEvents)
            {
                if (stopBrowserResult.IsFailure)
                {
                    _stopEvents.CloseBrowserFailed(sessionId, stopBrowserResult.Errors.ToArray());
                }
                else
                {
                    _stopEvents.BrowserClosed(sessionId);
                }
            }

            var closeResult = await connection.CloseAsync(ct);
            if (emitStopEvents)
            {
                if (closeResult.IsFailure)
                {
                    _stopEvents.CloseConnectionFailed(sessionId, closeResult.Errors.ToArray());
                }
                else
                {
                    _stopEvents.ConnectionClosed(sessionId);
                }
            }
        }

        _slotRegistry.Release(sessionId);
        if (emitStopEvents)
        {
            _stopEvents.SlotReleased(sessionId);
        }
    }

}
