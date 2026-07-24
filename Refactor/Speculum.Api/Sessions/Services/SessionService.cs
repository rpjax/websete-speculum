using Aidan.Core.Patterns;
using Speculum.Api.BrowserClients;
using Speculum.Api.Profiles.Services.Contracts;
using Speculum.Api.Sessions.Aggregates;
using Speculum.Api.Sessions.Events.Services.Contracts;
using Speculum.Api.Sessions.Models;
using Speculum.Api.Sessions.Pipes.Services.Contracts;
using Speculum.Api.Sessions.Requests;
using Speculum.Api.Sessions.Responses;
using Speculum.Api.Sessions.Services.Contracts;

namespace Speculum.Api.Sessions.Services;

public partial class SessionService : ISessionService
{
    private readonly IProfileRepository _profiles;
    private readonly ISessionRepository _sessions;
    private readonly ISessionSlotRegistry _slotRegistry;
    private readonly ISessionCollector _sessionCollector;
    private readonly ISessionPipeService _pipes;
    private readonly IUrlResolver _urls;
    private readonly ISessionEventsFactory _events;
    private readonly IBrowserClient _browserClient;
    private readonly ISessionTokenGenerator _sessionTokens;

    public SessionService(
        IProfileRepository profiles,
        ISessionRepository sessions,
        ISessionSlotRegistry slotRegistry,
        ISessionCollector sessionCollector,
        ISessionPipeService pipes,
        IUrlResolver urls,
        ISessionEventsFactory events,
        IBrowserClient browserClient,
        ISessionTokenGenerator sessionTokens)
    {
        _profiles = profiles;
        _sessions = sessions;
        _slotRegistry = slotRegistry;
        _sessionCollector = sessionCollector;
        _pipes = pipes;
        _urls = urls;
        _events = events;
        _browserClient = browserClient;
        _sessionTokens = sessionTokens;
    }

    public async Task<IResult<StartSessionResponse>> StartSessionAsync(
        StartSession request,
        CancellationToken ct = default)
    {
        var sessionId = Guid.NewGuid();
        var profileId = request.ProfileId;
        var startEvents = _events.ForSessionStart(sessionId, profileId);
        var lifecycleEvents = _events.ForSessionLifecycle(sessionId, profileId);

        var profile = await _profiles.LoadAsync(profileId, ct);
        if (profile is null)
        {
            startEvents.ProfileNotFound();
            return Result<StartSessionResponse>.Failure("Profile not found");
        }

        if (!_slotRegistry.TryAquire(sessionId))
        {
            startEvents.NoSlotAvailable();
            return Result<StartSessionResponse>.Failure("No session slot available");
        }

        startEvents.SlotAcquired();
        lifecycleEvents.Starting();

        try
        {
            var connectionResult = await _browserClient.StartConnectionAsync(sessionId, ct);
            if (connectionResult.IsFailure)
            {
                startEvents.ConnectionStartFailed(connectionResult.Errors.ToArray());
                return await AbortStartAsync(sessionId, profileId, lifecycleEvents, connectionResult, ct);
            }

            startEvents.ConnectionStarted();
            var connection = connectionResult.Value;

            var launchResult = await connection.LaunchBrowserAsync(request.Configuration, ct);
            if (launchResult.IsFailure)
            {
                startEvents.LaunchBrowserFailed(launchResult.Errors.ToArray());
                return await AbortStartAsync(sessionId, profileId, lifecycleEvents, launchResult, ct);
            }

            startEvents.BrowserLaunched();

            var restoreResult = await connection.RestoreProfileStateAsync(profile.State, ct);
            if (restoreResult.IsFailure)
            {
                startEvents.RestoreProfileStateFailed(restoreResult.Errors.ToArray());
                return await AbortStartAsync(sessionId, profileId, lifecycleEvents, restoreResult, ct);
            }

            startEvents.ProfileStateRestored();

            var urlResult = _urls.Resolve(request.Path, request.Query);
            if (urlResult.IsFailure)
            {
                startEvents.InitialUrlResolveFailed(urlResult.Errors.ToArray());
                return await AbortStartAsync(sessionId, profileId, lifecycleEvents, urlResult, ct);
            }

            startEvents.InitialUrlResolved(urlResult.Value);

            var navigationResult = await connection.NavigateAsync(urlResult.Value, ct);
            if (navigationResult.IsFailure)
            {
                startEvents.InitialNavigationFailed(navigationResult.Errors.ToArray());
                return await AbortStartAsync(sessionId, profileId, lifecycleEvents, navigationResult, ct);
            }

            startEvents.InitialNavigationCompleted();

            var token = _sessionTokens.GetRandom();
            await _sessions.SaveAsync(Session.Create(sessionId, profileId, token), ct);

            _sessionCollector.Watch(sessionId);
            lifecycleEvents.Started();
            return Result<StartSessionResponse>.Success(new StartSessionResponse
            {
                SessionId = sessionId,
                Token = token,
            });
        }
        catch
        {
            await TearDownLiveResourcesAsync(sessionId, profileId, ct, emitStopEvents: false);
            lifecycleEvents.Aborted();
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

        var lifecycleEvents = _events.ForSessionLifecycle(session);
        var stopEvents = _events.ForSessionStop(session);

        lifecycleEvents.Stopping();

        await TryPersistSessionStateAsync(session, stopEvents, ct);

        session.MarkStopped();
        await _sessions.SaveAsync(session, ct);

        await TearDownLiveResourcesAsync(session.Id, session.ProfileId, ct, emitStopEvents: true, stopEvents);

        lifecycleEvents.Stopped();
        return Result.Success();
    }

    private async Task<IResult<StartSessionResponse>> AbortStartAsync(
        Guid sessionId,
        Guid profileId,
        ISessionLifecycleEvents lifecycleEvents,
        IResult failed,
        CancellationToken ct)
    {
        await TearDownLiveResourcesAsync(sessionId, profileId, ct, emitStopEvents: false);
        lifecycleEvents.Aborted();
        return Result<StartSessionResponse>.Failure(failed.Errors.ToArray());
    }

    private async Task TryPersistSessionStateAsync(
        Session session,
        ISessionStopEvents stopEvents,
        CancellationToken ct)
    {
        var sessionId = session.Id;

        if (!_browserClient.TryGetConnection(sessionId, out var connection))
        {
            stopEvents.PersistSkippedNoConnection();
            return;
        }

        var profile = await _profiles.LoadAsync(session.ProfileId, ct);
        if (profile is null)
        {
            stopEvents.PersistSkippedProfileNotFound();
            return;
        }

        var exportResult = await connection.ExportSessionStateAsync(ct);
        if (exportResult.IsFailure)
        {
            stopEvents.ExportSessionStateFailed(exportResult.Errors.ToArray());
            return;
        }

        profile.ApplySessionExport(exportResult.Value);
        await _profiles.SaveAsync(profile, ct);
        stopEvents.SessionStatePersisted();
    }

    private async Task TearDownLiveResourcesAsync(
        Guid sessionId,
        Guid profileId,
        CancellationToken ct,
        bool emitStopEvents,
        ISessionStopEvents? stopEvents = null)
    {
        stopEvents ??= emitStopEvents
            ? _events.ForSessionStop(sessionId, profileId)
            : null;

        _pipes.CloseAllSessionPipes(sessionId);
        _sessionCollector.Unwatch(sessionId);

        if (_browserClient.TryGetConnection(sessionId, out var connection))
        {
            var stopBrowserResult = await connection.StopBrowserAsync(ct);
            if (emitStopEvents && stopEvents is not null)
            {
                if (stopBrowserResult.IsFailure)
                {
                    stopEvents.CloseBrowserFailed(stopBrowserResult.Errors.ToArray());
                }
                else
                {
                    stopEvents.BrowserClosed();
                }
            }

            var closeResult = await connection.CloseAsync(ct);
            if (emitStopEvents && stopEvents is not null)
            {
                if (closeResult.IsFailure)
                {
                    stopEvents.CloseConnectionFailed(closeResult.Errors.ToArray());
                }
                else
                {
                    stopEvents.ConnectionClosed();
                }
            }
        }

        _slotRegistry.Release(sessionId);
        if (emitStopEvents && stopEvents is not null)
        {
            stopEvents.SlotReleased();
        }
    }
}
