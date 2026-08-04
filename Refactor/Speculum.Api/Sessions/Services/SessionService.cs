using Aidan.Core.Patterns;
using Speculum.Api.BrowserClients;
using Speculum.Api.Configurations.Services.Contracts;
using Speculum.Api.Profiles.Services.Contracts;
using Speculum.Api.Sessions.Aggregates;
using Speculum.Api.Sessions.Events.Models;
using Speculum.Api.Sessions.Events.Services.Contracts;
using Speculum.Api.Sessions.Models;
using Speculum.Api.Sessions.Requests;
using Speculum.Api.Sessions.Responses;
using Speculum.Api.Sessions.Services.Contracts;
using Speculum.Api.Shared.Services.Contracts;
using Speculum.Api.Telemetry.Events.Services.Contracts;

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
    private readonly ISessionTelemetryEventsFactory _telemetry;
    private readonly IBrowserClient _browserClient;
    private readonly ISessionTokenGenerator _sessionTokens;
    private readonly IAsyncScopedMutex _lifecycleGate;
    private readonly ISessionBindingRegistry _bindings;
    private readonly IConfigurationService _configuration;
    private readonly ISessionDrainOrchestrator _drain;
    private readonly SessionConfigAssembler _configAssembler;

    public SessionService(
        IProfileRepository profiles,
        ISessionRepository sessions,
        ISessionSlotRegistry slotRegistry,
        ISessionCollector sessionCollector,
        ILiveSessionService liveSessions,
        IUrlResolver urls,
        ISessionEventsFactory events,
        ISessionTelemetryEventsFactory telemetry,
        IBrowserClient browserClient,
        ISessionTokenGenerator sessionTokens,
        IAsyncScopedMutex lifecycleGate,
        ISessionBindingRegistry bindings,
        IConfigurationService configuration,
        ISessionDrainOrchestrator drain,
        ILaunchScriptResolver launchScripts)
    {
        _profiles = profiles;
        _sessions = sessions;
        _slotRegistry = slotRegistry;
        _sessionCollector = sessionCollector;
        _liveSessions = liveSessions;
        _urls = urls;
        _events = events;
        _telemetry = telemetry;
        _browserClient = browserClient;
        _sessionTokens = sessionTokens;
        _lifecycleGate = lifecycleGate;
        _bindings = bindings;
        _configuration = configuration;
        _drain = drain;
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

        var sessionId = Guid.NewGuid();
        var profileId = request.ProfileId;
        var startEvents = _events.ForSessionStart(sessionId, profileId);
        var lifecycleEvents = _events.ForSessionLifecycle(sessionId, profileId);
        var telemetry = _telemetry.ForSession(sessionId, profileId);
        var persisted = false;

        if (_drain.IsDraining)
        {
            startEvents.StartRefused("draining");
            return Result<StartSessionResponse>.Failure(
                "Sessions are draining; try again shortly.");
        }

        if (!_configuration.AreMandatorySettingsSatisfied)
        {
            var missing = string.Join(", ", _configuration.MissingRequired);
            startEvents.StartRefused("pending_config");
            return Result<StartSessionResponse>.Failure(
                $"Pending config: mandatory settings incomplete ({missing}).");
        }

        var engineConfiguration = _configuration.GetCurrent();
        var sessionConfiguration = await _configAssembler
            .AssembleAsync(request, engineConfiguration, ct)
            .ConfigureAwait(false);
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

        if (_drain.IsDraining)
        {
            startEvents.StartRefused("draining");
            return Result<StartSessionResponse>.Failure(
                "Sessions are draining; try again shortly.");
        }

        var binding = _bindings.BeginStart(request.CallerId, sessionId);
        if (_drain.IsDraining)
        {
            _bindings.TryCancelStart(request.CallerId, sessionId);
            startEvents.StartRefused("draining");
            return Result<StartSessionResponse>.Failure(
                "Sessions are draining; try again shortly.");
        }

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
                    startEvents.StartRefused("replace_failed", replace.Errors.ToArray());
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
                    ? "disconnected"
                    : "cancelled";
                startEvents.StartRefused(waitReason);
                return Result<StartSessionResponse>.Failure("Session start was cancelled");
            }

            if (!_slotRegistry.TryAquire(sessionId))
            {
                _bindings.TryCancelStart(request.CallerId, sessionId);
                telemetry.Capacity.NoSlotAvailable();
                startEvents.StartRefused("no_slot");
                return Result<StartSessionResponse>.Failure("No session slot available");
            }

            telemetry.Capacity.SlotAcquired();
            lifecycleEvents.Starting();

            var browserLaunched = false;
            try
            {
                var connectionResult = await _browserClient.StartConnectionAsync(sessionId, startCt)
                    .ConfigureAwait(false);
                if (connectionResult.IsFailure)
                {
                    startEvents.ConnectionStartFailed(connectionResult.Errors.ToArray());
                    return await AbortStartAsync(
                        request.CallerId, sessionId, profileId, persisted, lifecycleEvents,
                        connectionResult, StopReason.Faulted, browserLaunched: false)
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
                        launchResult, StopReason.Faulted, browserLaunched: false)
                        .ConfigureAwait(false);
                }

                startEvents.BrowserLaunched();
                browserLaunched = true;

                var restoreResult = await connection.RestoreProfileStateAsync(profile.State, startCt)
                    .ConfigureAwait(false);
                if (restoreResult.IsFailure)
                {
                    startEvents.RestoreProfileStateFailed(restoreResult.Errors.ToArray());
                    return await AbortStartAsync(
                        request.CallerId, sessionId, profileId, persisted, lifecycleEvents,
                        restoreResult, StopReason.Faulted, browserLaunched)
                        .ConfigureAwait(false);
                }

                startEvents.ProfileStateRestored(restoreResult.Value);

                var urlResult = _urls.Resolve(request.Path, request.Query, request.RequestHost);
                if (urlResult.IsFailure)
                {
                    telemetry.Start.UrlResolveFailed(urlResult.Errors.ToArray());
                    startEvents.InitialNavigationFailed(urlResult.Errors.ToArray(), phase: "Resolve");
                    return await AbortStartAsync(
                        request.CallerId, sessionId, profileId, persisted, lifecycleEvents,
                        urlResult, StopReason.Faulted, browserLaunched)
                        .ConfigureAwait(false);
                }

                var initialUrl = urlResult.Value;
                telemetry.Start.UrlResolved(initialUrl);

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
                        live, StopReason.Faulted, browserLaunched)
                        .ConfigureAwait(false);
                }

                // Arm detached timer only after live context exists.
                _sessionCollector.Watch(sessionId);
                var attachment = live.Value.Attach(request.AttachedClient);
                if (attachment.IsFailure)
                {
                    return await AbortStartAsync(
                            request.CallerId, sessionId, profileId, persisted, lifecycleEvents,
                            attachment, StopReason.Faulted, browserLaunched)
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
                            StopReason.Cancelled,
                            browserLaunched)
                        .ConfigureAwait(false);
                }

                lifecycleEvents.Started();
                await _profiles.TouchLastUsedAsync(profileId, ct).ConfigureAwait(false);

                // Do not await — TTFF must not wait on target page load.
                _ = CompleteInitialNavigationAsync(sessionId, profileId, live.Value, initialUrl);

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
                lifecycleEvents.Aborted(reason);
                await CompensateStartFailureAsync(
                        sessionId, profileId, persisted, reason, CancellationToken.None, browserLaunched)
                    .ConfigureAwait(false);
                return Result<StartSessionResponse>.Failure("Session start was cancelled");
            }
            catch (Exception ex)
            {
                _bindings.TryCancelStart(request.CallerId, sessionId);
                lifecycleEvents.Aborted(StopReason.Faulted, JournalError.From(ex));
                await CompensateStartFailureAsync(
                        sessionId, profileId, persisted, StopReason.Faulted, CancellationToken.None, browserLaunched)
                    .ConfigureAwait(false);
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
            var telemetry = _telemetry.ForSession(session.Id, session.ProfileId);

            lifecycleEvents.Stopping(request.Reason);

            // Persist while the sidecar connection is still open.
            await TryPersistSessionStateAsync(session, stopEvents, telemetry, CancellationToken.None)
                .ConfigureAwait(false);

            session.MarkStopped(request.Reason);
            await _sessions.SaveAsync(session, CancellationToken.None).ConfigureAwait(false);

            await TearDownLiveResourcesAsync(
                    session.Id,
                    session.ProfileId,
                    CancellationToken.None,
                    emitStopEvents: true,
                    stopEvents,
                    telemetry)
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
        StopReason reason,
        bool browserLaunched)
    {
        _bindings.TryCancelStart(callerId, sessionId);
        // Journal lifecycle abort before teardown so a hung Stop/Close cannot orphan the narrative.
        lifecycleEvents.Aborted(reason, JournalError.From(failed.Errors.ToArray()));
        try
        {
            await CompensateStartFailureAsync(
                    sessionId, profileId, persisted, reason, CancellationToken.None, browserLaunched)
                .ConfigureAwait(false);
        }
        finally
        {
            _bindings.CompleteStart(sessionId);
        }

        return Result<StartSessionResponse>.Failure(failed.Errors.ToArray());
    }

    /// <summary>
    /// Fire-and-forget initial navigation after Live. Failures are journalled; they do not abort the session.
    /// </summary>
    private async Task CompleteInitialNavigationAsync(
        Guid sessionId,
        Guid profileId,
        ILiveSession live,
        string url)
    {
        var startEvents = _events.ForSessionStart(sessionId, profileId);
        try
        {
            var navigationResult = await live.NavigateToAbsoluteUrlAsync(url, CancellationToken.None)
                .ConfigureAwait(false);
            if (navigationResult.IsFailure)
            {
                startEvents.InitialNavigationFailed(
                    navigationResult.Errors.ToArray(),
                    phase: "Navigate",
                    url: url);
                return;
            }

            startEvents.InitialNavigationCompleted(url);
        }
        catch (Exception ex)
        {
            startEvents.InitialNavigationFailed(
                Result.Failure(ex.Message).Errors.ToArray(),
                phase: "Navigate",
                url: url);
        }
    }

    private async Task CompensateStartFailureAsync(
        Guid sessionId,
        Guid profileId,
        bool persisted,
        StopReason reason,
        CancellationToken ct,
        bool browserLaunched)
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

        // Journal connection (and browser, when launched) close on the sad path so the
        // session timeline pairs ConnectionStarted with ConnectionClosed.
        await TearDownLiveResourcesAsync(
                sessionId,
                profileId,
                ct,
                emitStopEvents: true,
                journalBrowserStop: browserLaunched)
            .ConfigureAwait(false);
    }

    private async Task TryPersistSessionStateAsync(
        Session session,
        ISessionStopEvents stopEvents,
        ISessionTelemetryEvents telemetry,
        CancellationToken ct)
    {
        var sessionId = session.Id;

        if (!_browserClient.TryGetConnection(sessionId, out var connection))
        {
            telemetry.Persist.SkippedNoConnection();
            stopEvents.ExportSessionStateSkipped("no_connection");
            return;
        }

        var exportResult = await connection.ExportSessionStateAsync(ct).ConfigureAwait(false);
        if (exportResult.IsFailure)
        {
            stopEvents.ExportSessionStateFailed(exportResult.Errors.ToArray());
            return;
        }

        if (!await _profiles.MergeSessionExportAsync(session.ProfileId, exportResult.Value, ct)
                .ConfigureAwait(false))
        {
            telemetry.Persist.SkippedProfileNotFound();
            stopEvents.ExportSessionStateSkipped("profile_not_found");
            return;
        }

        stopEvents.SessionStatePersisted();
        telemetry.Persist.Succeeded();
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
        ISessionStopEvents? stopEvents = null,
        ISessionTelemetryEvents? telemetry = null,
        bool journalBrowserStop = true)
    {
        stopEvents ??= emitStopEvents
            ? _events.ForSessionStop(sessionId, profileId)
            : null;
        telemetry ??= emitStopEvents
            ? _telemetry.ForSession(sessionId, profileId)
            : null;

        _bindings.CloseSession(sessionId);
        _liveSessions.Release(sessionId);
        _sessionCollector.Unwatch(sessionId);

        if (_browserClient.TryGetConnection(sessionId, out var connection))
        {
            try
            {
                var stopBrowserResult = await connection.StopBrowserAsync(ct).ConfigureAwait(false);
                if (emitStopEvents && journalBrowserStop && stopEvents is not null)
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
            catch (Exception ex)
            {
                if (emitStopEvents && journalBrowserStop && stopEvents is not null)
                {
                    stopEvents.CloseBrowserFailed(Result.Failure(ex.Message).Errors.ToArray());
                }
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
            catch (Exception ex)
            {
                if (emitStopEvents && stopEvents is not null)
                {
                    stopEvents.CloseConnectionFailed(Result.Failure(ex.Message).Errors.ToArray());
                }
            }
        }

        _slotRegistry.Release(sessionId);
        if (emitStopEvents && telemetry is not null)
        {
            telemetry.Capacity.SlotReleased();
        }
    }
}
