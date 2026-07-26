using System.Threading.Channels;
using Aidan.Core.Patterns;
using Aidan.Core.Errors;
using Speculum.Api.BrowserClients;
using Speculum.Api.Sessions.Events.Services.Contracts;
using Speculum.Api.Sessions.Models;
using Speculum.Api.Sessions.Requests;
using Speculum.Api.Sessions.Services.Contracts;
using Speculum.Api.Shared.Services;

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
    private readonly ILogger _logger;
    private readonly string _requestHost;
    private readonly bool _jsBridgeEnabled;
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

    public Guid SessionId { get; }

    internal LiveSession(
        Guid sessionId,
        ISessionConnection connection,
        ISessionStreamMultiplexer mux,
        SessionHooks hooks,
        ISessionCollector collector,
        ISessionFaultScheduler faults,
        IUrlResolver urls,
        string requestHost,
        bool jsBridgeEnabled,
        ISessionLiveEvents liveEvents,
        ILogger logger)
    {
        SessionId = sessionId;
        _connection = connection;
        _mux = mux;
        _hooks = hooks;
        _collector = collector;
        _faults = faults;
        _urls = urls;
        _requestHost = requestHost;
        _jsBridgeEnabled = jsBridgeEnabled;
        _liveEvents = liveEvents;
        _logger = logger;

        hooks.BindToConnection(connection);
    }

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
                            command = "SyncUrl";
                            await client.SyncUrlAsync(url, cancellationToken).ConfigureAwait(false);
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
                            _liveEvents.AttachedClientCommandFailed(command, ex);
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
                    _liveEvents.AttachedClientCommandFailed("SessionEnded", ex);
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
                        _liveEvents.LocationChanged(notification.Url.Trim());
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
                    _liveEvents.InputRejected(
                        notification.ErrorCode,
                        notification.Message,
                        notification.Phase);
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

    public IResult<Task> ConsumeConsoleInputAsync(
        ChannelReader<ConsoleInput> channelReader,
        CancellationToken ct = default)
        => StartInputPump(
            (consumerId, token) => _mux.StartConsoleInputPump(consumerId, channelReader, token),
            ct);

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
        return Result<SessionStatus>.Success(new SessionStatus
        {
            TabCount = current.TabCount,
            Url = current.Url,
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
                    _liveEvents.NavigateUrlResolved(url);
                }
                catch (Exception journalEx)
                {
                    _logger.LogWarning(
                        journalEx,
                        "Session {SessionId} failed to journal NavigateUrlResolved.",
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
            () =>
            {
                var requestId = string.IsNullOrWhiteSpace(request.RequestId)
                    ? Guid.CreateVersion7().ToString("D")
                    : request.RequestId.Trim();

                // Optional device: empty profile maps to no proto device (size-only resize).
                return _connection.ResizeAsync(
                    requestId,
                    request.Width,
                    request.Height,
                    request.Device ?? new DeviceProfile(),
                    ct);
            },
            ct);
    }

    public Task<IResult<DiagProbeResult>> RequestDiagnosticsAsync(
        ProbeSession request,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(request.Probe);
        return WithCommandGateAsync(
            () => _connection.RequestDiagnosticsAsync(request.Probe, ct),
            ct);
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
