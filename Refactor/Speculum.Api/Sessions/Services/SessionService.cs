using Aidan.Core.Patterns;
using Speculum.Api.BrowserClients;
using Speculum.Api.Profiles.Services.Contracts;
using Speculum.Api.Sessions.Aggregates;
using Speculum.Api.Sessions.Events.Services.Contracts;
using Speculum.Api.Sessions.Models;
using Speculum.Api.Sessions.Requests;
using Speculum.Api.Sessions.Responses;
using Speculum.Api.Sessions.Services.Contracts;
using Speculum.Api.Shared.Services.Contracts;

namespace Speculum.Api.Sessions.Services;

/// <summary>
/// Session lifecycle orchestrator: durable state + sidecar connection + live runtime context.
/// </summary>
public sealed class SessionService : ISessionService
{
    private readonly IProfileRepository _profiles;
    private readonly ISessionRepository _sessions;
    private readonly ISessionSlotRegistry _slotRegistry;
    private readonly ISessionCollector _sessionCollector;
    private readonly ILiveSessionService _liveSessions;
    private readonly IUrlResolver _urls;
    private readonly ISessionEventsFactory _events;
    private readonly IBrowserClient _browserClient;
    private readonly ISessionTokenGenerator _sessionTokens;
    private readonly IAsyncScopedMutex _lifecycleGate;

    public SessionService(
        IProfileRepository profiles,
        ISessionRepository sessions,
        ISessionSlotRegistry slotRegistry,
        ISessionCollector sessionCollector,
        ILiveSessionService liveSessions,
        IUrlResolver urls,
        ISessionEventsFactory events,
        IBrowserClient browserClient,
        ISessionTokenGenerator sessionTokens,
        IAsyncScopedMutex lifecycleGate)
    {
        _profiles = profiles;
        _sessions = sessions;
        _slotRegistry = slotRegistry;
        _sessionCollector = sessionCollector;
        _liveSessions = liveSessions;
        _urls = urls;
        _events = events;
        _browserClient = browserClient;
        _sessionTokens = sessionTokens;
        _lifecycleGate = lifecycleGate;
    }

    public async Task<IResult<StartSessionResponse>> StartSessionAsync(
        StartSession request,
        CancellationToken ct = default)
    {
        var sessionId = Guid.NewGuid();
        var profileId = request.ProfileId;
        var startEvents = _events.ForSessionStart(sessionId, profileId);
        var lifecycleEvents = _events.ForSessionLifecycle(sessionId, profileId);
        var persisted = false;

        var profile = await _profiles.LoadAsync(profileId, ct).ConfigureAwait(false);
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
            var connectionResult = await _browserClient.StartConnectionAsync(sessionId, ct)
                .ConfigureAwait(false);
            if (connectionResult.IsFailure)
            {
                startEvents.ConnectionStartFailed(connectionResult.Errors.ToArray());
                return await AbortStartAsync(
                    sessionId, profileId, persisted, lifecycleEvents, connectionResult, ct)
                    .ConfigureAwait(false);
            }

            startEvents.ConnectionStarted();
            var connection = connectionResult.Value;

            var launchResult = await connection.LaunchBrowserAsync(request.Configuration, ct)
                .ConfigureAwait(false);
            if (launchResult.IsFailure)
            {
                startEvents.LaunchBrowserFailed(launchResult.Errors.ToArray());
                return await AbortStartAsync(
                    sessionId, profileId, persisted, lifecycleEvents, launchResult, ct)
                    .ConfigureAwait(false);
            }

            startEvents.BrowserLaunched();

            var restoreResult = await connection.RestoreProfileStateAsync(profile.State, ct)
                .ConfigureAwait(false);
            if (restoreResult.IsFailure)
            {
                startEvents.RestoreProfileStateFailed(restoreResult.Errors.ToArray());
                return await AbortStartAsync(
                    sessionId, profileId, persisted, lifecycleEvents, restoreResult, ct)
                    .ConfigureAwait(false);
            }

            startEvents.ProfileStateRestored();

            var urlResult = _urls.Resolve(request.Path, request.Query);
            if (urlResult.IsFailure)
            {
                startEvents.InitialUrlResolveFailed(urlResult.Errors.ToArray());
                return await AbortStartAsync(
                    sessionId, profileId, persisted, lifecycleEvents, urlResult, ct)
                    .ConfigureAwait(false);
            }

            startEvents.InitialUrlResolved(urlResult.Value);

            var navigationResult = await connection.NavigateAsync(urlResult.Value, ct)
                .ConfigureAwait(false);
            if (navigationResult.IsFailure)
            {
                startEvents.InitialNavigationFailed(navigationResult.Errors.ToArray());
                return await AbortStartAsync(
                    sessionId, profileId, persisted, lifecycleEvents, navigationResult, ct)
                    .ConfigureAwait(false);
            }

            startEvents.InitialNavigationCompleted();

            var token = _sessionTokens.GetRandom();
            await _sessions.SaveAsync(Session.Create(sessionId, profileId, token), ct)
                .ConfigureAwait(false);
            persisted = true;

            // Bind runtime to the connection we just provisioned (no re-resolve).
            var live = _liveSessions.Create(sessionId, connection);
            if (live.IsFailure)
            {
                return await AbortStartAsync(
                    sessionId, profileId, persisted, lifecycleEvents, live, ct)
                    .ConfigureAwait(false);
            }

            // Arm detached timer only after live context exists.
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
            await CompensateStartFailureAsync(sessionId, profileId, persisted, ct)
                .ConfigureAwait(false);
            lifecycleEvents.Aborted();
            throw;
        }
    }

    public async Task<IResult> StopSessionAsync(
        StopSession request,
        CancellationToken ct = default)
    {
        var sessionId = request.SessionId;

        await using (await _lifecycleGate.AcquireAsync(sessionId, ct).ConfigureAwait(false))
        {
            var session = await _sessions.LoadAsync(sessionId, ct).ConfigureAwait(false);

            if (session is null)
            {
                return Result.Failure("Session not found");
            }

            if (session.State is LifecycleState.Stopped or LifecycleState.Aborted)
            {
                await TearDownLiveResourcesAsync(session.Id, session.ProfileId, ct, emitStopEvents: false)
                    .ConfigureAwait(false);
                return Result.Success();
            }

            var lifecycleEvents = _events.ForSessionLifecycle(session);
            var stopEvents = _events.ForSessionStop(session);

            lifecycleEvents.Stopping();

            // Persist while the sidecar connection is still open.
            await TryPersistSessionStateAsync(session, stopEvents, ct).ConfigureAwait(false);

            session.MarkStopped();
            await _sessions.SaveAsync(session, ct).ConfigureAwait(false);

            await TearDownLiveResourcesAsync(session.Id, session.ProfileId, ct, emitStopEvents: true, stopEvents)
                .ConfigureAwait(false);

            lifecycleEvents.Stopped();
            return Result.Success();
        }
    }

    private async Task<IResult<StartSessionResponse>> AbortStartAsync(
        Guid sessionId,
        Guid profileId,
        bool persisted,
        ISessionLifecycleEvents lifecycleEvents,
        IResult failed,
        CancellationToken ct)
    {
        await CompensateStartFailureAsync(sessionId, profileId, persisted, ct)
            .ConfigureAwait(false);
        lifecycleEvents.Aborted();
        return Result<StartSessionResponse>.Failure(failed.Errors.ToArray());
    }

    private async Task CompensateStartFailureAsync(
        Guid sessionId,
        Guid profileId,
        bool persisted,
        CancellationToken ct)
    {
        if (persisted)
        {
            var session = await _sessions.LoadAsync(sessionId, ct).ConfigureAwait(false);
            if (session is { State: LifecycleState.Live })
            {
                session.MarkAborted();
                await _sessions.SaveAsync(session, ct).ConfigureAwait(false);
            }
        }

        await TearDownLiveResourcesAsync(
                sessionId,
                profileId,
                ct,
                emitStopEvents: false)
            .ConfigureAwait(false);
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

        var profile = await _profiles.LoadAsync(session.ProfileId, ct).ConfigureAwait(false);
        if (profile is null)
        {
            stopEvents.PersistSkippedProfileNotFound();
            return;
        }

        var exportResult = await connection.ExportSessionStateAsync(ct).ConfigureAwait(false);
        if (exportResult.IsFailure)
        {
            stopEvents.ExportSessionStateFailed(exportResult.Errors.ToArray());
            return;
        }

        profile.ApplySessionExport(exportResult.Value);
        await _profiles.SaveAsync(profile, ct).ConfigureAwait(false);
        stopEvents.SessionStatePersisted();
    }

    /// <summary>
    /// Tears down runtime resources. Order:
    /// 1) dispose live context (mux/hooks/attachments),
    /// 2) unwatch collector,
    /// 3) stop browser + close connection,
    /// 4) release slot.
    /// Each step is best-effort so a failure does not skip the rest.
    /// </summary>
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

        _liveSessions.Release(sessionId);
        _sessionCollector.Unwatch(sessionId);

        if (_browserClient.TryGetConnection(sessionId, out var connection))
        {
            try
            {
                var stopBrowserResult = await connection.StopBrowserAsync(ct).ConfigureAwait(false);
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
            }
            catch
            {
                // Best-effort: still attempt Close + slot release.
            }

            try
            {
                var closeResult = await connection.CloseAsync(ct).ConfigureAwait(false);
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
            catch
            {
                // Best-effort: still release the slot.
            }
        }

        _slotRegistry.Release(sessionId);
        if (emitStopEvents && stopEvents is not null)
        {
            stopEvents.SlotReleased();
        }
    }
}
