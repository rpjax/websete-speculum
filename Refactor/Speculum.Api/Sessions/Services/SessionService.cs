using Aidan.Core.Patterns;
using Speculum.Api.BrowserClients;
using Speculum.Api.Configurations.Services.Contracts;
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
    private readonly ISessionBindingRegistry _bindings;
    private readonly IConfigurationService _configuration;
    private readonly SessionConfigAssembler _configAssembler;

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
        IAsyncScopedMutex lifecycleGate,
        ISessionBindingRegistry bindings,
        IConfigurationService configuration,
        ILaunchScriptResolver launchScripts)
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
        _bindings = bindings;
        _configuration = configuration;
        _configAssembler = new SessionConfigAssembler(launchScripts);
    }

    public async Task<IResult<StartSessionResponse>> StartSessionAsync(
        StartSession request,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(request.AttachedClient);
        if (string.IsNullOrWhiteSpace(request.CallerId))
        {
            return Result<StartSessionResponse>.Failure("Caller id is required");
        }

        if (!_configuration.AreMandatorySettingsSatisfied)
        {
            var missing = string.Join(", ", _configuration.MissingRequired);
            return Result<StartSessionResponse>.Failure(
                $"Pending config: mandatory settings incomplete ({missing}).");
        }

        var sessionId = Guid.NewGuid();
        var profileId = request.ProfileId;
        var startEvents = _events.ForSessionStart(sessionId, profileId);
        var lifecycleEvents = _events.ForSessionLifecycle(sessionId, profileId);
        var persisted = false;

        var engineConfiguration = _configuration.GetCurrent();
        var sessionConfiguration = _configAssembler.Assemble(request, engineConfiguration);
        if (sessionConfiguration.IsFailure)
        {
            startEvents.StartConfigurationRejected(sessionConfiguration.Errors.ToArray());
            return Result<StartSessionResponse>.Failure(
                sessionConfiguration.Errors.ToArray());
        }

        var profile = await _profiles.LoadAsync(profileId, ct).ConfigureAwait(false);
        if (profile is null)
        {
            startEvents.ProfileNotFound();
            return Result<StartSessionResponse>.Failure("Profile not found");
        }

        var binding = _bindings.BeginStart(request.CallerId, sessionId);
        try
        {
            if (binding.ReplacedSessionId is { } replacedSessionId)
            {
                var replace = await StopSessionAsync(
                        new StopSession
                        {
                            SessionId = replacedSessionId,
                            Reason = StopReason.Replaced,
                        },
                        CancellationToken.None)
                    .ConfigureAwait(false);
                if (replace.IsFailure)
                {
                    _bindings.TryCancelStart(request.CallerId, sessionId);
                    return Result<StartSessionResponse>.Failure(replace.Errors.ToArray());
                }
            }

            using var startLifetime = CancellationTokenSource.CreateLinkedTokenSource(
                ct,
                binding.CancellationToken);
            var startCt = startLifetime.Token;
            try
            {
                await binding.PreviousStartCompletion
                    .WaitAsync(startCt)
                    .ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                _bindings.TryCancelStart(request.CallerId, sessionId);
                var waitReason = ct.IsCancellationRequested
                    ? StopReason.Disconnected
                    : StopReason.Cancelled;
                lifecycleEvents.Aborted(waitReason);
                return Result<StartSessionResponse>.Failure("Session start was cancelled");
            }

            if (!_slotRegistry.TryAquire(sessionId))
            {
                _bindings.TryCancelStart(request.CallerId, sessionId);
                startEvents.NoSlotAvailable();
                return Result<StartSessionResponse>.Failure("No session slot available");
            }

            startEvents.SlotAcquired();
            lifecycleEvents.Starting();

            try
            {
                var connectionResult = await _browserClient.StartConnectionAsync(sessionId, startCt)
                    .ConfigureAwait(false);
                if (connectionResult.IsFailure)
                {
                    startEvents.ConnectionStartFailed(connectionResult.Errors.ToArray());
                    return await AbortStartAsync(
                        request.CallerId, sessionId, profileId, persisted, lifecycleEvents,
                        connectionResult, StopReason.Faulted)
                        .ConfigureAwait(false);
                }

                startEvents.ConnectionStarted();
                var connection = connectionResult.Value;

                var launchResult = await connection.LaunchBrowserAsync(sessionConfiguration.Value, startCt)
                    .ConfigureAwait(false);
                if (launchResult.IsFailure)
                {
                    startEvents.LaunchBrowserFailed(launchResult.Errors.ToArray());
                    return await AbortStartAsync(
                        request.CallerId, sessionId, profileId, persisted, lifecycleEvents,
                        launchResult, StopReason.Faulted)
                        .ConfigureAwait(false);
                }

                startEvents.BrowserLaunched();

                var restoreResult = await connection.RestoreProfileStateAsync(profile.State, startCt)
                    .ConfigureAwait(false);
                if (restoreResult.IsFailure)
                {
                    startEvents.RestoreProfileStateFailed(restoreResult.Errors.ToArray());
                    return await AbortStartAsync(
                        request.CallerId, sessionId, profileId, persisted, lifecycleEvents,
                        restoreResult, StopReason.Faulted)
                        .ConfigureAwait(false);
                }

                startEvents.ProfileStateRestored();

                var urlResult = _urls.Resolve(request.Path, request.Query, request.RequestHost);
                if (urlResult.IsFailure)
                {
                    startEvents.StartUrlResolveFailed(urlResult.Errors.ToArray());
                    return await AbortStartAsync(
                        request.CallerId, sessionId, profileId, persisted, lifecycleEvents,
                        urlResult, StopReason.Faulted)
                        .ConfigureAwait(false);
                }

                startEvents.StartUrlResolved(urlResult.Value);

                var navigationResult = await connection.NavigateAsync(urlResult.Value, startCt)
                    .ConfigureAwait(false);
                if (navigationResult.IsFailure)
                {
                    startEvents.InitialNavigationFailed(navigationResult.Errors.ToArray());
                    return await AbortStartAsync(
                        request.CallerId, sessionId, profileId, persisted, lifecycleEvents,
                        navigationResult, StopReason.Faulted)
                        .ConfigureAwait(false);
                }

                startEvents.InitialNavigationCompleted();

                var token = _sessionTokens.GetRandom();
                await _sessions.SaveAsync(Session.Create(sessionId, profileId, token), startCt)
                    .ConfigureAwait(false);
                persisted = true;

                // Bind runtime to the connection we just provisioned (no re-resolve).
                var live = _liveSessions.Create(
                    sessionId,
                    profileId,
                    connection,
                    request.RequestHost,
                    sessionConfiguration.Value.JsBridgeEnabled);
                if (live.IsFailure)
                {
                    return await AbortStartAsync(
                        request.CallerId, sessionId, profileId, persisted, lifecycleEvents,
                        live, StopReason.Faulted)
                        .ConfigureAwait(false);
                }

                // Arm detached timer only after live context exists.
                _sessionCollector.Watch(sessionId);
                var attachment = live.Value.Attach(request.AttachedClient);
                if (attachment.IsFailure)
                {
                    return await AbortStartAsync(
                            request.CallerId, sessionId, profileId, persisted, lifecycleEvents,
                            attachment, StopReason.Faulted)
                        .ConfigureAwait(false);
                }

                if (!_bindings.TryPromote(
                        request.CallerId,
                        sessionId,
                        attachment.Value,
                        token))
                {
                    live.Value.Detach(attachment.Value);
                    return await AbortStartAsync(
                            request.CallerId, sessionId, profileId, persisted, lifecycleEvents,
                            Result.Failure("Session start was cancelled"),
                            StopReason.Cancelled)
                        .ConfigureAwait(false);
                }

                lifecycleEvents.Started();
                return Result<StartSessionResponse>.Success(new StartSessionResponse
                {
                    SessionId = sessionId,
                    Token = token,
                });
            }
            catch (OperationCanceledException)
            {
                _bindings.TryCancelStart(request.CallerId, sessionId);
                var reason = ct.IsCancellationRequested
                    ? StopReason.Disconnected
                    : StopReason.Cancelled;
                await CompensateStartFailureAsync(
                        sessionId, profileId, persisted, reason, CancellationToken.None)
                    .ConfigureAwait(false);
                lifecycleEvents.Aborted(reason);
                return Result<StartSessionResponse>.Failure("Session start was cancelled");
            }
            catch
            {
                _bindings.TryCancelStart(request.CallerId, sessionId);
                await CompensateStartFailureAsync(
                        sessionId, profileId, persisted, StopReason.Faulted, CancellationToken.None)
                    .ConfigureAwait(false);
                lifecycleEvents.Aborted(StopReason.Faulted);
                throw;
            }
        }
        finally
        {
            _bindings.CompleteStart(sessionId);
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
                await TearDownLiveResourcesAsync(
                        session.Id,
                        session.ProfileId,
                        CancellationToken.None,
                        emitStopEvents: false)
                    .ConfigureAwait(false);
                return Result.Success();
            }

            var lifecycleEvents = _events.ForSessionLifecycle(session);
            var stopEvents = _events.ForSessionStop(session);

            lifecycleEvents.Stopping(request.Reason);

            // Persist while the sidecar connection is still open.
            await TryPersistSessionStateAsync(session, stopEvents, CancellationToken.None)
                .ConfigureAwait(false);

            session.MarkStopped(request.Reason);
            await _sessions.SaveAsync(session, CancellationToken.None).ConfigureAwait(false);

            await TearDownLiveResourcesAsync(
                    session.Id,
                    session.ProfileId,
                    CancellationToken.None,
                    emitStopEvents: true,
                    stopEvents)
                .ConfigureAwait(false);

            lifecycleEvents.Stopped(request.Reason);
            return Result.Success();
        }
    }

    private async Task<IResult<StartSessionResponse>> AbortStartAsync(
        string callerId,
        Guid sessionId,
        Guid profileId,
        bool persisted,
        ISessionLifecycleEvents lifecycleEvents,
        IResult failed,
        StopReason reason)
    {
        _bindings.TryCancelStart(callerId, sessionId);
        await CompensateStartFailureAsync(
                sessionId, profileId, persisted, reason, CancellationToken.None)
            .ConfigureAwait(false);
        _bindings.CompleteStart(sessionId);
        lifecycleEvents.Aborted(reason);
        return Result<StartSessionResponse>.Failure(failed.Errors.ToArray());
    }

    private async Task CompensateStartFailureAsync(
        Guid sessionId,
        Guid profileId,
        bool persisted,
        StopReason reason,
        CancellationToken ct)
    {
        if (persisted)
        {
            var session = await _sessions.LoadAsync(sessionId, ct).ConfigureAwait(false);
            if (session is { State: LifecycleState.Live })
            {
                session.MarkAborted(reason);
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

        _bindings.CloseSession(sessionId);
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
