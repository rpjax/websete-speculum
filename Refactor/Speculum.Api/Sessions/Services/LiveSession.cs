using System.Threading.Channels;
using Aidan.Core.Patterns;
using Aidan.Core.Errors;
using Speculum.Api.BrowserClients;
using Speculum.Api.Configurations.Models.Sessions;
using Speculum.Api.Journal.Services.Contracts;
using Speculum.Api.Sessions.Events.Services.Contracts;
using Speculum.Api.Sessions.Mirror;
using Speculum.Api.Sessions.Mirror.DomProjection;
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
    private readonly SessionResizeCoalescer _resizeCoalescer = new();

    private readonly MirrorMode _mirrorMode;
    private Guid? _attachmentId;
    private IAttachedSessionClient? _attachedClient;
    private INotificationStream? _featureNotifications;
    private Task? _featureLoop;
    private CancellationTokenSource? _lifetime = new();
    private int _released;
    private int _abandoned;
    private int _videoStreamingInputAdmissionStarted;
    private VideoStreamingInputAdmissionChannel? _videoStreamingInputAdmission;
    private int _domProjectionInputAdmissionStarted;
    private DomProjectionInputAdmissionChannel? _domProjectionInputAdmission;

    public Guid SessionId { get; }

    public MirrorMode MirrorMode => _mirrorMode;

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
        MirrorMode mirrorMode,
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
        _mirrorMode = mirrorMode;
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
        var admission = Interlocked.Exchange(ref _videoStreamingInputAdmission, null);
        admission?.Complete();
        var domAdmission = Interlocked.Exchange(ref _domProjectionInputAdmission, null);
        domAdmission?.Complete();
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

                if (client is null)
                {
                    continue;
                }

                if (notification.Kind == SessionNotificationKind.EditableFocusChanged)
                {
                    try
                    {
                        await client.EditableFocusChangedAsync(notification.Editing, cancellationToken)
                            .ConfigureAwait(false);
                    }
                    catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                    {
                        throw;
                    }
                    catch (Exception ex)
                    {
                        _logger.LogDebug(
                            ex,
                            "Session {SessionId} failed to push EditableFocusChanged to attached client.",
                            SessionId);
                        try
                        {
                            _telemetry.Client.AttachedCommandFailed("EditableFocusChanged", ex);
                        }
                        catch (Exception journalEx)
                        {
                            _logger.LogWarning(
                                journalEx,
                                "Session {SessionId} failed to journal AttachedClientCommandFailed.",
                                SessionId);
                        }
                    }

                    continue;
                }

                if (string.IsNullOrWhiteSpace(notification.Url))
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
                case SessionNotificationKind.VideoStreamingInputRejected:
                    _telemetry.VideoStreamingInput.Rejected(
                        notification.ErrorCode,
                        notification.Message,
                        notification.Phase,
                        notification.TraceId,
                        notification.ClientTimestampMs);
                    break;
                case SessionNotificationKind.VideoStreamingInputApplied:
                    if (!string.IsNullOrWhiteSpace(notification.InputKind))
                    {
                        _telemetry.VideoStreamingInput.Applied(
                            notification.InputKind.Trim(),
                            notification.Phase,
                            notification.TraceId,
                            notification.ClientTimestampMs);
                    }

                    break;
                case SessionNotificationKind.VideoStreamingInputPathTrace:
                    if (string.IsNullOrWhiteSpace(notification.InputKind)
                        || string.IsNullOrWhiteSpace(notification.Phase))
                    {
                        break;
                    }

                    var pathKind = notification.InputKind.Trim();
                    switch (notification.Phase.Trim())
                    {
                        case "data_plane_received":
                            _telemetry.VideoStreamingInput.DataPlaneReceived(
                                pathKind,
                                notification.TraceId,
                                notification.ClientTimestampMs);
                            break;
                        case "grpc_pushed":
                            _telemetry.VideoStreamingInput.SidecarPushWritten(
                                pathKind,
                                null,
                                notification.TraceId,
                                notification.ClientTimestampMs);
                            break;
                        case "sidecar_admitted":
                            _telemetry.VideoStreamingInput.SidecarAdmitted(
                                pathKind,
                                notification.TraceId,
                                notification.ClientTimestampMs);
                            break;
                    }

                    break;
                case SessionNotificationKind.DomProjectionInputRejected:
                    _telemetry.DomProjection.Input.Rejected(
                        notification.ErrorCode,
                        notification.Message,
                        notification.Phase,
                        notification.DomGeneration,
                        notification.DomAnchor,
                        notification.TraceId,
                        notification.ClientTimestampMs);
                    break;
                case SessionNotificationKind.DomProjectionInputApplied:
                    if (!string.IsNullOrWhiteSpace(notification.InputKind))
                    {
                        _telemetry.DomProjection.Input.Applied(
                            notification.InputKind.Trim(),
                            notification.Phase,
                            notification.DomGeneration,
                            notification.DomAnchor,
                            notification.TraceId,
                            notification.ClientTimestampMs);
                    }

                    break;
                case SessionNotificationKind.DomProjectionInputPathTrace:
                    if (string.IsNullOrWhiteSpace(notification.InputKind)
                        || string.IsNullOrWhiteSpace(notification.Phase))
                    {
                        break;
                    }

                    var domKind = notification.InputKind.Trim();
                    switch (notification.Phase.Trim())
                    {
                        case "data_plane_received":
                            _telemetry.DomProjection.Input.DataPlaneReceived(
                                domKind,
                                notification.DomGeneration,
                                notification.DomAnchor,
                                notification.TraceId,
                                notification.ClientTimestampMs);
                            break;
                        case "grpc_pushed":
                            _telemetry.DomProjection.Input.SidecarPushWritten(
                                domKind,
                                null,
                                notification.DomGeneration,
                                notification.DomAnchor,
                                notification.TraceId,
                                notification.ClientTimestampMs);
                            break;
                        case "sidecar_admitted":
                            _telemetry.DomProjection.Input.SidecarAdmitted(
                                domKind,
                                notification.DomGeneration,
                                notification.DomAnchor,
                                notification.TraceId,
                                notification.ClientTimestampMs);
                            break;
                        case "cdp_dropped":
                            _telemetry.DomProjection.Input.CdpDropped(
                                domKind,
                                notification.Reason,
                                notification.DomGeneration,
                                notification.DomAnchor,
                                notification.TraceId,
                                notification.ClientTimestampMs);
                            break;
                    }

                    break;
                case SessionNotificationKind.DomProjectionDiffFrame:
                    if (string.IsNullOrWhiteSpace(notification.DomDiffKind))
                    {
                        break;
                    }

                    _telemetry.DomProjection.Diff.FrameReceived(
                        notification.DomDiffKind.Trim(),
                        notification.DomDiffTarget,
                        notification.DomDiffTreeType,
                        notification.DomDiffSequence ?? 0,
                        notification.DomGeneration ?? 0,
                        notification.DomDiffTimestamp ?? 0,
                        notification.DomDiffNodeCount,
                        notification.DomDiffUrlCount);
                    break;
                case SessionNotificationKind.DomProjectionLifecycle:
                    if (!string.Equals(notification.Phase, "generation_bumped", StringComparison.Ordinal)
                        || string.IsNullOrWhiteSpace(notification.Reason))
                    {
                        break;
                    }

                    _telemetry.DomProjection.Diff.GenerationBumped(
                        notification.DomFromGeneration ?? 0,
                        notification.DomGeneration ?? 0,
                        notification.Reason.Trim(),
                        notification.Url,
                        notification.DomDiffKind);
                    break;
                case SessionNotificationKind.AllocationLifecycle:
                    if (string.IsNullOrWhiteSpace(notification.AllocationKind))
                    {
                        break;
                    }

                    switch (notification.AllocationKind.Trim())
                    {
                        case "session_allocated":
                            _telemetry.Sidecar.SessionAllocated(notification.InputBackend);
                            break;
                        case "session_released":
                            _telemetry.Sidecar.SessionReleased(notification.Reason);
                            break;
                        case "display_allocated":
                            _telemetry.Sidecar.DisplayAllocated(
                                notification.DisplayWidth,
                                notification.DisplayHeight,
                                notification.LogicalWidth,
                                notification.LogicalHeight,
                                notification.InputBackend);
                            break;
                        case "display_released":
                            _telemetry.Sidecar.DisplayReleased(
                                notification.DisplayWidth,
                                notification.DisplayHeight,
                                notification.LogicalWidth,
                                notification.LogicalHeight,
                                notification.InputBackend,
                                notification.Reason);
                            break;
                        case "allocation_faulted":
                            if (!string.IsNullOrWhiteSpace(notification.ErrorCode)
                                && !string.IsNullOrWhiteSpace(notification.Phase))
                            {
                                _telemetry.Sidecar.AllocationFaulted(
                                    notification.DisplayWidth,
                                    notification.DisplayHeight,
                                    notification.LogicalWidth,
                                    notification.LogicalHeight,
                                    notification.InputBackend,
                                    notification.ErrorCode.Trim(),
                                    notification.Phase.Trim(),
                                    notification.Reason);
                            }

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
    {
        if (_mirrorMode != MirrorMode.VideoStreaming)
        {
            return Result<IFrameStream>.Failure(SessionMirrorErrors.VideoStreamingRequiredMessage);
        }

        return OpenStream(static (id, mux) => (IFrameStream)new FrameStream(id, mux));
    }

    public IResult<IDomDiffStream> OpenDomDiffStream()
    {
        if (_mirrorMode != MirrorMode.DomProjection)
        {
            return Result<IDomDiffStream>.Failure(SessionMirrorErrors.DomProjectionRequiredMessage);
        }

        return OpenStream(static (id, mux) => (IDomDiffStream)new DomDiffStream(id, mux));
    }

    public IResult<IConsoleOutputStream> OpenConsoleOutputStream()
        => OpenStream(static (id, mux) => (IConsoleOutputStream)new ConsoleOutputStream(id, mux));

    public IResult<INotificationStream> OpenNotificationStream()
        => OpenStream(static (id, mux) => (INotificationStream)new NotificationStream(id, mux));

    public IResult<Task> ConsumeVideoStreamingInputAsync(
        ChannelReader<VideoStreamingInput> channelReader,
        CancellationToken ct = default)
    {
        if (_mirrorMode != MirrorMode.VideoStreaming)
        {
            return Result<Task>.Failure(SessionMirrorErrors.VideoStreamingRequiredMessage);
        }

        return StartInputPump(
            (consumerId, token) => _mux.StartVideoStreamingInputPump(consumerId, channelReader, token),
            ct);
    }

    public IResult AdmitVideoStreamingInput(VideoStreamingInput input)
    {
        ArgumentNullException.ThrowIfNull(input);
        if (_mirrorMode != MirrorMode.VideoStreaming)
        {
            return Result.Failure(SessionMirrorErrors.VideoStreamingRequiredMessage);
        }

        if (string.IsNullOrWhiteSpace(input.Type) || string.IsNullOrWhiteSpace(input.Payload))
        {
            return Result.Failure("VideoStreamingInput type and payload are required");
        }

        var ensure = EnsureVideoStreamingInputAdmission();
        if (ensure.IsFailure)
        {
            return ensure;
        }

        var admission = Volatile.Read(ref _videoStreamingInputAdmission);
        if (admission is null)
        {
            return Result.Failure("Video streaming input admission is not ready");
        }

        admission.Admit(new VideoStreamingInput
        {
            Type = input.Type.Trim(),
            Payload = input.Payload,
            TraceId = input.TraceId,
            ClientTimestampMs = input.ClientTimestampMs,
        });
        return Result.Success();
    }

    public IResult AdmitDomProjectionInput(DomProjectionInput input)
    {
        ArgumentNullException.ThrowIfNull(input);
        if (_mirrorMode != MirrorMode.DomProjection)
        {
            return Result.Failure(SessionMirrorErrors.DomProjectionRequiredMessage);
        }

        if (string.IsNullOrWhiteSpace(input.Type))
        {
            return Result.Failure("DomProjectionInput type is required");
        }

        var ensure = EnsureDomProjectionInputAdmission();
        if (ensure.IsFailure)
        {
            return ensure;
        }

        var admission = Volatile.Read(ref _domProjectionInputAdmission);
        if (admission is null)
        {
            return Result.Failure("Dom projection input admission is not ready");
        }

        admission.Admit(new DomProjectionInput
        {
            Generation = input.Generation,
            Type = input.Type.Trim(),
            Anchor = input.Anchor,
            TimestampClient = input.TimestampClient,
            TraceId = input.TraceId,
            Payload = string.IsNullOrWhiteSpace(input.Payload) ? "{}" : input.Payload,
        }, out var dropped);

        if (dropped is not null
            && _journalCatalog.IsTypeEnabled(TelemetryJournalFacts.DomProjectionInputAdmissionDropped))
        {
            long? clientTs = dropped.TimestampClient is { } ts && double.IsFinite(ts)
                ? (long)Math.Round(ts)
                : null;
            _telemetry.DomProjection.Input.AdmissionDropped(
                dropped.Type,
                dropped.Generation,
                dropped.Anchor,
                dropped.TraceId,
                clientTs);
        }

        return Result.Success();
    }

    public IResult<Task> ConsumeDomProjectionInputAsync(
        ChannelReader<DomProjectionInput> channelReader,
        CancellationToken ct = default)
    {
        if (_mirrorMode != MirrorMode.DomProjection)
        {
            return Result<Task>.Failure(SessionMirrorErrors.DomProjectionRequiredMessage);
        }

        if (IsReleased)
        {
            return Result<Task>.Failure("Live session is released");
        }

        if (!TryGetLifetimeToken(out var lifetimeToken))
        {
            return Result<Task>.Failure("Live session is released");
        }

        var linked = CancellationTokenSource.CreateLinkedTokenSource(ct, lifetimeToken);
        var pump = _connection.ConsumeDomProjectionInputAsync(channelReader);
        if (pump.IsFailure)
        {
            linked.Dispose();
            return pump;
        }

        return Result<Task>.Success(ObserveDomProjectionPumpAsync(pump.Value, linked));
    }

    public IResult<Task> ConsumeConsoleInputAsync(
        ChannelReader<ConsoleInput> channelReader,
        CancellationToken ct = default)
        => StartInputPump(
            (consumerId, token) => _mux.StartConsoleInputPump(consumerId, channelReader, token),
            ct);

    public void TraceVideoStreamingInputDataPlaneReceived(
        string kind,
        string? traceId = null,
        long? clientTimestampMs = null)
    {
        if (string.IsNullOrWhiteSpace(kind)
            || !_journalCatalog.IsTypeEnabled(TelemetryJournalFacts.VideoStreamingInputDataPlaneReceived))
        {
            return;
        }

        try
        {
            _telemetry.VideoStreamingInput.DataPlaneReceived(kind.Trim(), traceId, clientTimestampMs);
        }
        catch (Exception journalEx)
        {
            _logger.LogWarning(
                journalEx,
                "Session {SessionId} failed to journal Telemetry.Sessions.VideoStreamingInput.DataPlaneReceived.",
                SessionId);
        }
    }

    public void TraceVideoStreamingInputControlReceived(
        string kind,
        string? traceId = null,
        long? clientTimestampMs = null)
    {
        if (string.IsNullOrWhiteSpace(kind)
            || !_journalCatalog.IsTypeEnabled(TelemetryJournalFacts.VideoStreamingInputControlReceived))
        {
            return;
        }

        try
        {
            _telemetry.VideoStreamingInput.ControlReceived(kind.Trim(), traceId, clientTimestampMs);
        }
        catch (Exception journalEx)
        {
            _logger.LogWarning(
                journalEx,
                "Session {SessionId} failed to journal Telemetry.Sessions.VideoStreamingInput.ControlReceived.",
                SessionId);
        }
    }

    public void TraceDomProjectionInputDataPlaneReceived(
        string kind,
        long? generation,
        string? anchor,
        string? traceId = null,
        long? clientTimestampMs = null)
    {
        if (string.IsNullOrWhiteSpace(kind)
            || !_journalCatalog.IsTypeEnabled(TelemetryJournalFacts.DomProjectionInputDataPlaneReceived))
        {
            return;
        }

        try
        {
            _telemetry.DomProjection.Input.DataPlaneReceived(
                kind.Trim(),
                generation,
                anchor,
                traceId,
                clientTimestampMs);
        }
        catch (Exception journalEx)
        {
            _logger.LogWarning(
                journalEx,
                "Session {SessionId} failed to journal Telemetry.Sessions.DomProjection.Input.DataPlaneReceived.",
                SessionId);
        }
    }

    private IResult EnsureVideoStreamingInputAdmission()
    {
        if (IsReleased)
        {
            return Result.Failure("Live session is released");
        }

        if (Interlocked.CompareExchange(ref _videoStreamingInputAdmissionStarted, 1, 0) != 0)
        {
            // Another caller is starting or already started — wait briefly for the channel.
            var spun = 0;
            while (Volatile.Read(ref _videoStreamingInputAdmission) is null && !IsReleased && spun < 200)
            {
                Thread.SpinWait(20);
                spun++;
            }

            return Volatile.Read(ref _videoStreamingInputAdmission) is null
                ? Result.Failure("User input admission failed to start")
                : Result.Success();
        }

        var admission = VideoStreamingInputAdmissionChannel.Create();
        Volatile.Write(ref _videoStreamingInputAdmission, admission);
        var pump = ConsumeVideoStreamingInputAsync(admission.Reader);
        if (pump.IsFailure)
        {
            Volatile.Write(ref _videoStreamingInputAdmission, null);
            Interlocked.Exchange(ref _videoStreamingInputAdmissionStarted, 0);
            return Result.Failure(pump.Errors.ToArray());
        }

        // Pump runs until admission completes (Release) or the session lifetime cancels.
        _ = ObserveAdmissionPumpAsync(pump.Value);
        return Result.Success();
    }

    private IResult EnsureDomProjectionInputAdmission()
    {
        if (IsReleased)
        {
            return Result.Failure("Live session is released");
        }

        if (Interlocked.CompareExchange(ref _domProjectionInputAdmissionStarted, 1, 0) != 0)
        {
            var spun = 0;
            while (Volatile.Read(ref _domProjectionInputAdmission) is null && !IsReleased && spun < 200)
            {
                Thread.SpinWait(20);
                spun++;
            }

            return Volatile.Read(ref _domProjectionInputAdmission) is null
                ? Result.Failure("Dom projection input admission failed to start")
                : Result.Success();
        }

        var admission = DomProjectionInputAdmissionChannel.Create();
        Volatile.Write(ref _domProjectionInputAdmission, admission);
        var pump = ConsumeDomProjectionInputAsync(admission.Reader);
        if (pump.IsFailure)
        {
            Volatile.Write(ref _domProjectionInputAdmission, null);
            Interlocked.Exchange(ref _domProjectionInputAdmissionStarted, 0);
            return Result.Failure(pump.Errors.ToArray());
        }

        _ = ObserveAdmissionPumpAsync(pump.Value);
        return Result.Success();
    }

    private async Task ObserveDomProjectionPumpAsync(Task pump, CancellationTokenSource linked)
    {
        try
        {
            await pump.ConfigureAwait(false);
        }
        finally
        {
            linked.Dispose();
        }
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
            DisplayWidth = current.DisplayWidth,
            DisplayHeight = current.DisplayHeight,
            ChromeWidth = current.ChromeWidth,
            ChromeHeight = current.ChromeHeight,
            Fps = current.Fps,
            UptimeMs = Math.Max(1, Environment.TickCount64 - _startedTimestamp),
            SessionId = SessionId.ToString("D"),
            JsBridgeEnabled = _jsBridgeEnabled,
            Editing = current.Editing,
        });
    }

    public Task<IResult<NavigateResult>> NavigateAsync(NavigateSession request, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        return WithCommandGateAsync<NavigateResult>(
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
                    var first = urlResult.Errors.FirstOrDefault();
                    return Result<NavigateResult>.Success(new NavigateResult
                    {
                        Applied = false,
                        Outcome = NavigateOutcome.ResolveFailed,
                        ErrorCode = first?.Code ?? "url_resolve_failed",
                        Phase = "Resolve",
                        Message = first?.Message ?? string.Join("; ", urlResult.Errors.Select(e => e.Message)),
                    });
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
                    var first = navigated.Errors.FirstOrDefault();
                    return Result<NavigateResult>.Success(new NavigateResult
                    {
                        Applied = false,
                        Outcome = NavigateOutcome.NavigateFailed,
                        Url = url,
                        ErrorCode = first?.Code ?? "navigate_failed",
                        Phase = "Navigate",
                        Message = first?.Message ?? string.Join("; ", navigated.Errors.Select(e => e.Message)),
                    });
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

                return Result<NavigateResult>.Success(new NavigateResult
                {
                    Applied = true,
                    Outcome = NavigateOutcome.Applied,
                    Url = url,
                });
            },
            ct);
    }

    public Task<IResult> NavigateToAbsoluteUrlAsync(string url, CancellationToken ct = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(url);
        return WithCommandGateAsync(() => _connection.NavigateAsync(url, ct), ct);
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
        return _resizeCoalescer.SubmitAsync(request, ResizeWithGateAsync, ct);
    }

    private async Task<IResult<ResizeResult>> ResizeWithGateAsync(
        ResizeSession request,
        CancellationToken ct)
    {
        if (IsReleased || !_connection.IsOpen)
        {
            return Result<ResizeResult>.Failure("Live session is released");
        }

        var requestId = string.IsNullOrWhiteSpace(request.RequestId)
            ? Guid.CreateVersion7().ToString("D")
            : request.RequestId.Trim();

        // Busy-reject: do not queue behind Navigate/Refresh/prior Resize (client retries resize_busy).
        var lease = await _commandGate.TryAcquireAsync(SessionId, ct).ConfigureAwait(false);
        if (lease is null)
        {
            var busy = new ResizeResult
            {
                Applied = false,
                Outcome = ResizeOutcome.Busy,
                Width = request.Width,
                Height = request.Height,
                ResizeId = requestId,
                ErrorCode = "resize_busy",
                Phase = "validate",
                Message = "another command is in progress",
            };
            TryJournalResize(
                request.Width,
                request.Height,
                requestId,
                Result<ResizeResult>.Success(busy));
            return Result<ResizeResult>.Success(busy);
        }

        await using (lease.ConfigureAwait(false))
        {
            if (IsReleased || !_connection.IsOpen)
            {
                return Result<ResizeResult>.Failure("Live session is released");
            }

            // Optional device: empty profile maps to no proto device (size-only resize).
            var result = await _connection.ResizeAsync(
                requestId,
                request.Width,
                request.Height,
                request.Device ?? new DeviceProfile(),
                ct).ConfigureAwait(false);

            if (result.IsSuccess && result.Value.Outcome == ResizeOutcome.Applied && !result.Value.Applied)
            {
                // Mapper may only set Applied; normalize Outcome for soft rejects/fails.
                result.Value.Outcome = string.Equals(
                        result.Value.ErrorCode,
                        "resize_busy",
                        StringComparison.Ordinal)
                    ? ResizeOutcome.Busy
                    : ResizeOutcome.Rejected;
            }

            TryJournalResize(request.Width, request.Height, requestId, result);
            return result;
        }
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

    public async Task<IResult<DomAsset>> GetDomAssetAsync(
        string key,
        CancellationToken ct = default,
        string? kind = null,
        string? rangeHeader = null)
    {
        if (_mirrorMode != MirrorMode.DomProjection)
        {
            return Result<DomAsset>.Failure(SessionMirrorErrors.DomProjectionRequiredMessage);
        }

        if (string.IsNullOrWhiteSpace(key))
        {
            return Result<DomAsset>.Failure("Asset key is required");
        }

        if (IsReleased || !_connection.IsOpen)
        {
            return Result<DomAsset>.Failure("Live session is released");
        }

        return await _connection
            .GetDomAssetAsync(key.Trim(), ct, kind, rangeHeader)
            .ConfigureAwait(false);
    }

    public async Task<IResult> PutDomUploadAsync(
        string uploadId,
        byte[] body,
        string contentType,
        string name,
        CancellationToken ct = default)
    {
        if (_mirrorMode != MirrorMode.DomProjection)
        {
            return Result.Failure(SessionMirrorErrors.DomProjectionRequiredMessage);
        }

        if (string.IsNullOrWhiteSpace(uploadId) || body is null || body.Length == 0)
        {
            return Result.Failure("Upload id and body are required");
        }

        if (IsReleased || !_connection.IsOpen)
        {
            return Result.Failure("Live session is released");
        }

        return await _connection
            .PutDomUploadAsync(uploadId.Trim(), body, contentType, name, ct)
            .ConfigureAwait(false);
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
