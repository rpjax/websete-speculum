using System.Threading.Channels;
using Aidan.Core.Patterns;
using Aidan.Core.Errors;
using Speculum.Api.BrowserClients;
using Speculum.Api.Journal.Services.Contracts;
using Speculum.Api.Sessions.Events.Services.Contracts;
using Speculum.Api.Sessions.Models;
using Speculum.Api.Sessions.Requests;
using Speculum.Api.Sessions.Services.Contracts;
using Speculum.Api.Sessions.Services.Streaming;
using Speculum.Api.Shared.Services;
using Speculum.Api.Telemetry;
using Speculum.Api.Telemetry.Events.Services.Contracts;

namespace Speculum.Api.Sessions.Services;

/// <summary>
/// In-memory context for one live connection: mux, hooks, commands, one attached client.
/// Output streams are owned by callers (dispose to unregister); presence is Attach/Detach.
/// </summary>
internal sealed class LiveSession : ILiveSession
{
    private readonly ISessionConnection _connection;
    private readonly ISessionStreamMultiplexer _mux;
    private readonly SessionHooks _hooks;
    private readonly ISessionCollector _collector;
    private readonly ISessionFaultScheduler _faults;
    private readonly IUrlResolver _urls;
    private readonly ISessionLiveEvents _liveEvents;
    private readonly ISessionTelemetryEvents _telemetry;
    private readonly IJournalCatalog _journalCatalog;
    private readonly ILogger _logger;
    private readonly string _requestHost;
    private readonly bool _jsBridgeEnabled;
    private readonly Guid _profileId;
    private readonly long _startedTimestamp = Environment.TickCount64;
    private readonly ScopedMutex _commandGate = new();
    private readonly object _attachmentGate = new();

    private Guid? _attachmentId;
    private IAttachedSessionClient? _attachedClient;
    private INotificationStream? _featureNotifications;
    private Task? _featureLoop;
    private CancellationTokenSource? _lifetime = new();
    private int _released;
    private int _abandoned;
    private int _userInputAdmissionStarted;
    private Channel<UserInput>? _userInputAdmission;

    public Guid SessionId { get; }

    internal LiveSession(
        Guid sessionId,
        Guid profileId,
        ISessionConnection connection,
        ISessionStreamMultiplexer mux,
        SessionHooks hooks,
        ISessionCollector collector,
        ISessionFaultScheduler faults,
        IUrlResolver urls,
        string requestHost,
        bool jsBridgeEnabled,
        ISessionLiveEvents liveEvents,
        ISessionTelemetryEvents telemetry,
        IJournalCatalog journalCatalog,
        ILogger logger)
    {
        SessionId = sessionId;
        _profileId = profileId;
        _connection = connection;
        _mux = mux;
        _hooks = hooks;
        _collector = collector;
        _faults = faults;
        _urls = urls;
        _requestHost = requestHost;
        _jsBridgeEnabled = jsBridgeEnabled;
        _liveEvents = liveEvents;
        _telemetry = telemetry;
        _journalCatalog = journalCatalog;
        _logger = logger;

        hooks.BindToConnection(connection);
    }

    internal LiveSessionTelemetrySnapshot GetTelemetrySnapshot()
        => new(
            SessionId,
            _profileId,
            _jsBridgeEnabled,
            _connection.IsOpen && !IsReleased,
            Math.Max(1, Environment.TickCount64 - _startedTimestamp));

    internal void Release()
    {
        if (Interlocked.Exchange(ref _released, 1) != 0)
        {
            return;
        }

        lock (_attachmentGate)
        {
            if (_attachmentId is not null)
            {
                _collector.Release(SessionId);
            }

            _attachmentId = null;
            _attachedClient = null;
        }

        var lifetime = Interlocked.Exchange(ref _lifetime, null);
        if (lifetime is not null)
        {
            try
            {
                lifetime.Cancel();
            }
            finally
            {
                lifetime.Dispose();
            }
        }

        _featureNotifications?.Dispose();
        _featureNotifications = null;
        _hooks.Unbind(_connection.IsOpen ? _connection : null);
        var admission = Interlocked.Exchange(ref _userInputAdmission, null);
        admission?.Writer.TryComplete();
        _mux.Dispose();
    }

    private bool IsReleased => Volatile.Read(ref _released) != 0;

    // ── Caller attachment ────────────────────────────────────────────────────

    public IResult<Guid> Attach(IAttachedSessionClient client)
    {
        ArgumentNullException.ThrowIfNull(client);

        ChannelReader<SessionNotification>? featureReader = null;
        CancellationToken lifetimeToken = default;
        Guid attachedId;

        lock (_attachmentGate)
        {
            if (IsReleased)
            {
                return Result<Guid>.Failure("Live session is released");
            }

            if (_attachmentId is not null)
            {
                return Result<Guid>.Failure("A client is already attached");
            }

            if (_featureNotifications is null)
            {
                var stream = OpenNotificationStream();
                if (stream.IsFailure)
                {
                    return Result<Guid>.Failure(stream.Errors.ToArray());
                }

                if (!TryGetLifetimeToken(out lifetimeToken))
                {
                    stream.Value.Dispose();
                    return Result<Guid>.Failure("Live session is released");
                }

                var channel = stream.Value.GetNotificationChannel();
                if (channel.IsFailure)
                {
                    stream.Value.Dispose();
                    return Result<Guid>.Failure(channel.Errors.ToArray());
                }

                _featureNotifications = stream.Value;
                featureReader = channel.Value;
            }

            attachedId = Guid.CreateVersion7();
            _attachmentId = attachedId;
            _attachedClient = client;
            _collector.AddRef(SessionId);
        }

        if (featureReader is not null)
        {
            var loop = RunFeatureLoopAsync(featureReader, lifetimeToken);
            _featureLoop = loop;
            ObserveFeatureLoop(loop);
        }

        return Result<Guid>.Success(attachedId);
    }

    public IResult Detach(Guid attachmentId)
    {
        lock (_attachmentGate)
        {
            if (IsReleased)
            {
                // Release already dropped the attachment and collector ref.
                return Result.Success();
            }

            if (_attachmentId != attachmentId)
            {
                return Result.Failure("Attachment not found");
            }

            _attachmentId = null;
            _attachedClient = null;
            _collector.Release(SessionId);
            return Result.Success();
        }
    }

    private void ObserveFeatureLoop(Task loop)
    {
        _ = loop.ContinueWith(
            static (task, state) =>
            {
                var session = (LiveSession)state!;
                if (task.IsFaulted && task.Exception is not null)
                {
                    var error = task.Exception.GetBaseException();
                    session._logger.LogError(
                        error,
                        "Session {SessionId} feature loop faulted.",
                        session.SessionId);
                    try
                    {
                        session._liveEvents.FeatureLoopFaulted(error);
                    }
                    catch (Exception journalEx)
                    {
                        session._logger.LogWarning(
                            journalEx,
                            "Session {SessionId} failed to journal FeatureLoopFaulted.",
                            session.SessionId);
                    }
                }
            },
            this,
            CancellationToken.None,
            TaskContinuationOptions.ExecuteSynchronously | TaskContinuationOptions.OnlyOnFaulted,
            TaskScheduler.Default);
    }

    private async Task RunFeatureLoopAsync(
        ChannelReader<SessionNotification> reader,
        CancellationToken cancellationToken)
    {
        try
        {
            await foreach (var notification in reader.ReadAllAsync(cancellationToken)
                .ConfigureAwait(false))
            {
                TryJournalNotification(notification);

                if (notification.Kind == SessionNotificationKind.Crashed)
                {
                    // True sidecar onCrash (Chromium). gRPC link stays open until TearDown CloseAsync.
                    await AbandonAsync(
                            StopReason.Faulted,
                            notification.ErrorCode ?? "browser_crashed",
                            notification.Message ?? "Browser session crashed")
                        .ConfigureAwait(false);
                    break;
                }

                IAttachedSessionClient? client;
                lock (_attachmentGate)
                {
                    client = _attachedClient;
                }

                if (client is null || string.IsNullOrWhiteSpace(notification.Url))
                {
                    continue;
                }

                var url = notification.Url.Trim();
                string? command = null;
                try
                {
                    switch (notification.Kind)
                    {
                        case SessionNotificationKind.LocationChanged:
                            var projected = _urls.ProjectToClient(url, _requestHost);
                            if (projected.IsFailure)
                            {
                                _logger.LogDebug(
                                    "Session {SessionId} skipped SyncUrl; ProjectToClient failed: {Errors}",
                                    SessionId,
                                    string.Join("; ", projected.Errors.Select(error => error.Message)));
                                break;
                            }

                            command = "SyncUrl";
                            await client.SyncUrlAsync(projected.Value, cancellationToken)
                                .ConfigureAwait(false);
                            break;
                        case SessionNotificationKind.MainFrameNavigationBlocked:
                            command = "Redirect";
                            await client.RedirectAsync(url, cancellationToken).ConfigureAwait(false);
                            break;
                    }
                }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                {
                    throw;
                }
                catch (Exception ex)
                {
                    _logger.LogDebug(
                        ex,
                        "Session {SessionId} failed to push {Kind} to attached client.",
                        SessionId,
                        notification.Kind);
                    if (command is not null)
                    {
                        try
                        {
                            _telemetry.Client.AttachedCommandFailed(command, ex);
                        }
                        catch (Exception journalEx)
                        {
                            _logger.LogWarning(
                                journalEx,
                                "Session {SessionId} failed to journal AttachedClientCommandFailed.",
                                SessionId);
                        }
                    }
                }
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
        catch (ChannelClosedException)
        {
        }
        catch (ObjectDisposedException)
        {
        }
        finally
        {
            // Notification channel ended while still live → sidecar session link is gone.
            // Intentional Release cancels the lifetime token and skips this.
            if (!cancellationToken.IsCancellationRequested && !IsReleased)
            {
                await AbandonAsync(
                        StopReason.Faulted,
                        "sidecar_connection_ended",
                        "Sidecar session connection ended")
                    .ConfigureAwait(false);
            }
        }
    }

    /// <summary>
    /// Pushes <c>SessionEnded</c> once and schedules Faulted stop. Idempotent.
    /// Not tied to the feature-loop token — TearDown must not cancel abandon mid-flight.
    /// </summary>
    private async Task AbandonAsync(StopReason reason, string? errorCode, string? message)
    {
        if (Interlocked.Exchange(ref _abandoned, 1) != 0 || IsReleased)
        {
            return;
        }

        try
        {
            _liveEvents.LiveSessionAbandoned(
                reason.ToStableString(),
                errorCode,
                message);
        }
        catch (Exception journalEx)
        {
            _logger.LogWarning(
                journalEx,
                "Session {SessionId} failed to journal LiveSessionAbandoned.",
                SessionId);
        }

        IAttachedSessionClient? client;
        lock (_attachmentGate)
        {
            client = _attachedClient;
        }

        if (client is not null)
        {
            try
            {
                await client.SessionEndedAsync(
                        SessionId,
                        reason.ToStableString(),
                        errorCode,
                        message,
                        CancellationToken.None)
                    .ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                _logger.LogDebug(
                    ex,
                    "Session {SessionId} failed to push SessionEnded to attached client.",
                    SessionId);
                try
                {
                    _telemetry.Client.AttachedCommandFailed("SessionEnded", ex);
                }
                catch (Exception journalEx)
                {
                    _logger.LogWarning(
                        journalEx,
                        "Session {SessionId} failed to journal AttachedClientCommandFailed.",
                        SessionId);
                }
            }
        }

        _faults.RequestStop(SessionId, reason);
    }

    /// <summary>
    /// Journals browser notifications worth observing. Skips EditableFocusChanged (noisy).
    /// </summary>
    private void TryJournalNotification(SessionNotification notification)
    {
        try
        {
            switch (notification.Kind)
            {
                case SessionNotificationKind.LocationChanged:
                    if (!string.IsNullOrWhiteSpace(notification.Url))
                    {
                        _telemetry.Browse.LocationChanged(notification.Url.Trim());
                    }

                    break;
                case SessionNotificationKind.MainFrameNavigationBlocked:
                    if (!string.IsNullOrWhiteSpace(notification.Url))
                    {
                        _liveEvents.MainFrameNavigationBlocked(
                            notification.Url.Trim(),
                            notification.ErrorCode,
                            notification.Message);
                    }

                    break;
                case SessionNotificationKind.Crashed:
                    _liveEvents.BrowserCrashed(
                        notification.ErrorCode,
                        notification.Message,
                        notification.Phase);
                    break;
                case SessionNotificationKind.InputRejected:
                    _telemetry.Input.Rejected(
                        notification.ErrorCode,
                        notification.Message,
                        notification.Phase);
                    break;
                case SessionNotificationKind.InputApplied:
                    if (!string.IsNullOrWhiteSpace(notification.InputKind))
                    {
                        _telemetry.Input.Applied(
                            notification.InputKind.Trim(),
                            notification.Phase);
                    }

                    break;
                case SessionNotificationKind.InputPathTrace:
                    if (string.IsNullOrWhiteSpace(notification.InputKind)
                        || string.IsNullOrWhiteSpace(notification.Phase))
                    {
                        break;
                    }

                    var pathKind = notification.InputKind.Trim();
                    switch (notification.Phase.Trim())
                    {
                        case "wt_received":
                            _telemetry.Input.WebTransportReceived(pathKind);
                            break;
                        case "grpc_pushed":
                            _telemetry.Input.SidecarPushWritten(pathKind, null);
                            break;
                        case "sidecar_admitted":
                            _telemetry.Input.SidecarAdmitted(pathKind);
                            break;
                    }

                    break;
                // EditableFocusChanged — omitted (high churn, low narrative value).
            }
        }
        catch (Exception journalEx)
        {
            _logger.LogWarning(
                journalEx,
                "Session {SessionId} failed to journal notification {Kind}.",
                SessionId,
                notification.Kind);
        }
    }

    // ── Streams ──────────────────────────────────────────────────────────────

    public IResult<IFrameStream> OpenFrameStream()
        => OpenStream(static (id, mux) => (IFrameStream)new FrameStream(id, mux));

    public IResult<IConsoleOutputStream> OpenConsoleOutputStream()
        => OpenStream(static (id, mux) => (IConsoleOutputStream)new ConsoleOutputStream(id, mux));

    public IResult<INotificationStream> OpenNotificationStream()
        => OpenStream(static (id, mux) => (INotificationStream)new NotificationStream(id, mux));

    public IResult<Task> ConsumeUserInputAsync(
        ChannelReader<UserInput> channelReader,
        CancellationToken ct = default)
        => StartInputPump(
            (consumerId, token) => _mux.StartUserInputPump(consumerId, channelReader, token),
            ct);

    public IResult AdmitUserInput(UserInput input)
    {
        ArgumentNullException.ThrowIfNull(input);
        if (string.IsNullOrWhiteSpace(input.Type) || string.IsNullOrWhiteSpace(input.Payload))
        {
            return Result.Failure("UserInput type and payload are required");
        }

        var ensure = EnsureUserInputAdmission();
        if (ensure.IsFailure)
        {
            return ensure;
        }

        var channel = Volatile.Read(ref _userInputAdmission);
        if (channel is null)
        {
            return Result.Failure("User input admission is not ready");
        }

        // DropOldest: TryWrite always succeeds (may drop the oldest queued item).
        _ = channel.Writer.TryWrite(new UserInput
        {
            Type = input.Type.Trim(),
            Payload = input.Payload,
        });
        return Result.Success();
    }

    public IResult<Task> ConsumeConsoleInputAsync(
        ChannelReader<ConsoleInput> channelReader,
        CancellationToken ct = default)
        => StartInputPump(
            (consumerId, token) => _mux.StartConsoleInputPump(consumerId, channelReader, token),
            ct);

    public void TraceInputPathWtReceived(string kind)
    {
        if (string.IsNullOrWhiteSpace(kind)
            || !_journalCatalog.IsTypeEnabled(TelemetryJournalFacts.InputWebTransportReceived))
        {
            return;
        }

        try
        {
            _telemetry.Input.WebTransportReceived(kind.Trim());
        }
        catch (Exception journalEx)
        {
            _logger.LogWarning(
                journalEx,
                "Session {SessionId} failed to journal Telemetry.Sessions.Input.WebTransportReceived.",
                SessionId);
        }
    }

    public void TraceInputPathControlReceived(string kind)
    {
        if (string.IsNullOrWhiteSpace(kind)
            || !_journalCatalog.IsTypeEnabled(TelemetryJournalFacts.InputControlReceived))
        {
            return;
        }

        try
        {
            _telemetry.Input.ControlReceived(kind.Trim());
        }
        catch (Exception journalEx)
        {
            _logger.LogWarning(
                journalEx,
                "Session {SessionId} failed to journal Telemetry.Sessions.Input.ControlReceived.",
                SessionId);
        }
    }

    private IResult EnsureUserInputAdmission()
    {
        if (IsReleased)
        {
            return Result.Failure("Live session is released");
        }

        if (Interlocked.CompareExchange(ref _userInputAdmissionStarted, 1, 0) != 0)
        {
            // Another caller is starting or already started — wait briefly for the channel.
            var spun = 0;
            while (Volatile.Read(ref _userInputAdmission) is null && !IsReleased && spun < 200)
            {
                Thread.SpinWait(20);
                spun++;
            }

            return Volatile.Read(ref _userInputAdmission) is null
                ? Result.Failure("User input admission failed to start")
                : Result.Success();
        }

        var channel = DropOldestChannels.Create<UserInput>(64);
        Volatile.Write(ref _userInputAdmission, channel);
        var pump = ConsumeUserInputAsync(channel.Reader);
        if (pump.IsFailure)
        {
            Volatile.Write(ref _userInputAdmission, null);
            Interlocked.Exchange(ref _userInputAdmissionStarted, 0);
            return Result.Failure(pump.Errors.ToArray());
        }

        // Pump runs until admission completes (Release) or the session lifetime cancels.
        _ = ObserveAdmissionPumpAsync(pump.Value);
        return Result.Success();
    }

    private async Task ObserveAdmissionPumpAsync(Task pump)
    {
        try
        {
            await pump.ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            // session released
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Session {SessionId} user-input admission pump faulted.", SessionId);
        }
    }

    // ── Commands ─────────────────────────────────────────────────────────────

    public async Task<IResult<SessionStatus>> GetStatusAsync(CancellationToken ct = default)
    {
        if (IsReleased || !_connection.IsOpen)
        {
            return Result<SessionStatus>.Failure("Live session is released");
        }

        var status = await _connection.GetStatusAsync(ct).ConfigureAwait(false);
        if (status.IsFailure)
        {
            return status;
        }

        var current = status.Value;
        var url = current.Url;
        if (!string.IsNullOrWhiteSpace(url))
        {
            var projected = _urls.ProjectToClient(url.Trim(), _requestHost);
            if (projected.IsSuccess)
            {
                url = projected.Value;
            }
        }

        return Result<SessionStatus>.Success(new SessionStatus
        {
            TabCount = current.TabCount,
            Url = url,
            Resizing = current.Resizing,
            Width = current.Width,
            Height = current.Height,
            Fps = current.Fps,
            UptimeMs = Math.Max(1, Environment.TickCount64 - _startedTimestamp),
            SessionId = SessionId.ToString("D"),
            JsBridgeEnabled = _jsBridgeEnabled,
            Editing = current.Editing,
        });
    }

    public Task<IResult> NavigateAsync(NavigateSession request, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        return WithCommandGateAsync(
            async () =>
            {
                var path = request.Path ?? string.Empty;
                var query = request.Query ?? string.Empty;
                try
                {
                    _liveEvents.NavigateRequested(path, query);
                }
                catch (Exception journalEx)
                {
                    _logger.LogWarning(
                        journalEx,
                        "Session {SessionId} failed to journal NavigateRequested.",
                        SessionId);
                }

                var urlResult = _urls.Resolve(path, query, _requestHost);
                if (urlResult.IsFailure)
                {
                    TryJournalNavigateFailed("Resolve", urlResult.Errors.ToArray());
                    return Result.Failure(urlResult.Errors.ToArray());
                }

                var url = urlResult.Value;
                try
                {
                    _telemetry.Navigate.UrlResolved(url);
                }
                catch (Exception journalEx)
                {
                    _logger.LogWarning(
                        journalEx,
                        "Session {SessionId} failed to journal Telemetry.Sessions.Navigate.UrlResolved.",
                        SessionId);
                }

                var navigated = await _connection.NavigateAsync(url, ct).ConfigureAwait(false);
                if (navigated.IsFailure)
                {
                    TryJournalNavigateFailed("Navigate", navigated.Errors.ToArray());
                    return navigated;
                }

                try
                {
                    _liveEvents.NavigateCompleted(url);
                }
                catch (Exception journalEx)
                {
                    _logger.LogWarning(
                        journalEx,
                        "Session {SessionId} failed to journal NavigateCompleted.",
                        SessionId);
                }

                return navigated;
            },
            ct);
    }

    private void TryJournalNavigateFailed(string phase, Error[] errors)
    {
        try
        {
            _liveEvents.NavigateFailed(phase, errors);
        }
        catch (Exception journalEx)
        {
            _logger.LogWarning(
                journalEx,
                "Session {SessionId} failed to journal NavigateFailed ({Phase}).",
                SessionId,
                phase);
        }
    }

    public Task<IResult> RefreshAsync(CancellationToken ct = default)
        => WithCommandGateAsync(() => _connection.RefreshAsync(ct), ct);

    public Task<IResult<ResizeResult>> ResizeAsync(ResizeSession request, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        return WithCommandGateAsync(
            async () =>
            {
                var requestId = string.IsNullOrWhiteSpace(request.RequestId)
                    ? Guid.CreateVersion7().ToString("D")
                    : request.RequestId.Trim();

                // Optional device: empty profile maps to no proto device (size-only resize).
                var result = await _connection.ResizeAsync(
                    requestId,
                    request.Width,
                    request.Height,
                    request.Device ?? new DeviceProfile(),
                    ct).ConfigureAwait(false);

                TryJournalResize(request.Width, request.Height, requestId, result);
                return result;
            },
            ct);
    }

    private void TryJournalResize(
        int requestedWidth,
        int requestedHeight,
        string requestId,
        IResult<ResizeResult> result)
    {
        try
        {
            if (result.IsSuccess && result.Value.Applied)
            {
                _telemetry.Resize.Applied(
                    result.Value.Width,
                    result.Value.Height,
                    result.Value.ResizeId ?? requestId);
                return;
            }

            if (result.IsFailure)
            {
                var first = result.Errors.FirstOrDefault();
                _telemetry.Resize.Rejected(
                    requestedWidth,
                    requestedHeight,
                    requestId,
                    first?.Code,
                    first?.Message,
                    "validate");
                return;
            }

            _telemetry.Resize.Rejected(
                requestedWidth,
                requestedHeight,
                result.Value.ResizeId ?? requestId,
                result.Value.ErrorCode,
                result.Value.Message,
                result.Value.Phase ?? "resize");
        }
        catch (Exception journalEx)
        {
            _logger.LogWarning(
                journalEx,
                "Failed to journal resize for session {SessionId}",
                SessionId);
        }
    }

    public Task<IResult<DiagProbeResult>> RequestDiagnosticsAsync(
        ProbeSession request,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(request.Probe);
        // Unlocked vs navigate/resize (sidecar probe is unlocked too), but still
        // fail fast after Release — same guard as GetStatusAsync.
        if (IsReleased || !_connection.IsOpen)
        {
            return Task.FromResult<IResult<DiagProbeResult>>(
                Result<DiagProbeResult>.Failure("Live session is released"));
        }

        return _connection.RequestDiagnosticsAsync(request.Probe, ct);
    }

    // ── Hooks ────────────────────────────────────────────────────────────────

    public IResult<Guid> RegisterCameraPermission(
        Func<CancellationToken, Task<PermissionDecision>> handler)
        => IsReleased
            ? Result<Guid>.Failure("Live session is released")
            : _hooks.RegisterCameraPermission(handler);

    public IResult UnregisterCameraPermission(Guid registrationId)
        => IsReleased
            ? Result.Failure("Live session is released")
            : _hooks.UnregisterCameraPermission(registrationId);

    public IResult<Guid> RegisterMicrophonePermission(
        Func<CancellationToken, Task<PermissionDecision>> handler)
        => IsReleased
            ? Result<Guid>.Failure("Live session is released")
            : _hooks.RegisterMicrophonePermission(handler);

    public IResult UnregisterMicrophonePermission(Guid registrationId)
        => IsReleased
            ? Result.Failure("Live session is released")
            : _hooks.UnregisterMicrophonePermission(registrationId);

    private IResult<TStream> OpenStream<TStream>(
        Func<Guid, ISessionStreamMultiplexer, TStream> create)
    {
        if (IsReleased)
        {
            return Result<TStream>.Failure("Live session is released");
        }

        var id = Guid.CreateVersion7();
        var register = _mux.RegisterPipe(id);
        if (register.IsFailure)
        {
            return Result<TStream>.Failure(register.Errors.ToArray());
        }

        return Result<TStream>.Success(create(id, _mux));
    }

    private IResult<Task> StartInputPump(
        Func<Guid, CancellationToken, IResult<Task>> start,
        CancellationToken ct)
    {
        if (IsReleased)
        {
            return Result<Task>.Failure("Live session is released");
        }

        if (!TryGetLifetimeToken(out var lifetimeToken))
        {
            return Result<Task>.Failure("Live session is released");
        }

        var consumerId = Guid.CreateVersion7();
        var register = _mux.RegisterInputConsumer(consumerId);
        if (register.IsFailure)
        {
            return Result<Task>.Failure(register.Errors.ToArray());
        }

        var linked = CancellationTokenSource.CreateLinkedTokenSource(ct, lifetimeToken);
        var pump = start(consumerId, linked.Token);
        if (pump.IsFailure)
        {
            linked.Dispose();
            _mux.UnregisterInputConsumer(consumerId);
            return pump;
        }

        return Result<Task>.Success(
            ObserveAndUnregisterAsync(pump.Value, linked, consumerId));
    }

    private bool TryGetLifetimeToken(out CancellationToken token)
    {
        token = default;
        var lifetime = Volatile.Read(ref _lifetime);
        if (lifetime is null)
        {
            return false;
        }

        try
        {
            token = lifetime.Token;
            return true;
        }
        catch (ObjectDisposedException)
        {
            return false;
        }
    }

    private async Task<IResult> WithCommandGateAsync(
        Func<Task<IResult>> action,
        CancellationToken ct)
    {
        if (IsReleased || !_connection.IsOpen)
        {
            return Result.Failure("Live session is released");
        }

        await using (await _commandGate.AcquireAsync(SessionId, ct).ConfigureAwait(false))
        {
            if (IsReleased || !_connection.IsOpen)
            {
                return Result.Failure("Live session is released");
            }

            return await action().ConfigureAwait(false);
        }
    }

    private async Task<IResult<T>> WithCommandGateAsync<T>(
        Func<Task<IResult<T>>> action,
        CancellationToken ct)
    {
        if (IsReleased || !_connection.IsOpen)
        {
            return Result<T>.Failure("Live session is released");
        }

        await using (await _commandGate.AcquireAsync(SessionId, ct).ConfigureAwait(false))
        {
            if (IsReleased || !_connection.IsOpen)
            {
                return Result<T>.Failure("Live session is released");
            }

            return await action().ConfigureAwait(false);
        }
    }

    private async Task ObserveAndUnregisterAsync(
        Task pump,
        CancellationTokenSource linked,
        Guid consumerId)
    {
        try
        {
            await pump.ConfigureAwait(false);
        }
        finally
        {
            linked.Dispose();
            _mux.UnregisterInputConsumer(consumerId);
        }
    }
}
