using System.Threading.Channels;
using Aidan.Core.Patterns;
using Aidan.Core.Errors;
using Speculum.Api.BrowserClients;
using Speculum.Api.Configurations.Models.Sessions;
using Speculum.Api.Journal.Services.Contracts;
using Speculum.Api.Sessions.Events.Services.Contracts;
using Speculum.Api.Sessions.Mirror;
using Speculum.Api.Sessions.Mirror.PageProjection;
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
    private readonly ISharedAssetCacheL2 _sharedAssetCacheL2;
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
    private int _pageProjectionInputAdmissionStarted;
    private PageProjectionIntentAdmissionChannel? _pageProjectionInputAdmission;

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
        ISharedAssetCacheL2 sharedAssetCacheL2,
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
        _sharedAssetCacheL2 = sharedAssetCacheL2;
        _logger = logger;

        hooks.BindToConnection(connection);
        connection.BindPageProjectionDiffTelemetry(new DiffTelemetryBridge(this));
    }

    private sealed class DiffTelemetryBridge(LiveSession session) : IPageProjectionDiffTelemetry
    {
        public void FrameReceived(
            string plane,
            string operation,
            long sequence,
            long generation,
            long timestamp,
            int? sheetCount = null,
            int? ruleCount = null,
            int? seededSheetCount = null)
        {
            session.TracePageProjectionDiffFrameReceivedCore(
                plane,
                operation,
                sequence,
                generation,
                timestamp,
                sheetCount,
                ruleCount,
                seededSheetCount);
        }

        public void QueueDropped(
            string stage,
            int droppedCount,
            int capacity,
            long? sequence = null,
            long? generation = null,
            string? plane = null,
            string? operation = null,
            long? lowestDroppedSequence = null,
            long? highestDroppedSequence = null,
            string? reason = null,
            Guid? streamId = null,
            Guid? consumerId = null,
            string? kind = null,
            int? targetCount = null,
            int? diffChannelCount = null,
            long? diffEpoch = null)
        {
            session.TracePageProjectionDiffQueueDropped(
                stage,
                droppedCount,
                capacity,
                sequence,
                generation,
                plane,
                operation,
                lowestDroppedSequence,
                highestDroppedSequence,
                reason,
                streamId,
                consumerId,
                kind,
                targetCount,
                diffChannelCount,
                diffEpoch);
        }

        public void FanOutEnqueued(
            string plane,
            string operation,
            long sequence,
            long generation,
            long timestamp,
            long waitMs,
            Guid streamId,
            Guid consumerId,
            string kind,
            int targetIndex,
            int targetCount,
            int diffChannelCount,
            long diffEpoch)
        {
            session.TracePageProjectionDiffFanOutEnqueuedCore(
                plane,
                operation,
                sequence,
                generation,
                timestamp,
                waitMs,
                streamId,
                consumerId,
                kind,
                targetIndex,
                targetCount,
                diffChannelCount,
                diffEpoch);
        }

        public void OutputStreamOpened(
            Guid streamId,
            Guid consumerId,
            string kind,
            int openStreamCount,
            int diffChannelCapacity)
        {
            session.TracePageProjectionDiffOutputStreamOpened(
                streamId,
                consumerId,
                kind,
                openStreamCount,
                diffChannelCapacity);
        }

        public void OutputStreamClosed(
            Guid streamId,
            Guid consumerId,
            string kind,
            int openStreamCount)
        {
            session.TracePageProjectionDiffOutputStreamClosed(
                streamId,
                consumerId,
                kind,
                openStreamCount);
        }
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
            _mux.SetAttachedConsumer(null);
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
        _connection.BindPageProjectionDiffTelemetry(null);
        _hooks.Unbind(_connection.IsOpen ? _connection : null);
        var admission = Interlocked.Exchange(ref _videoStreamingInputAdmission, null);
        admission?.Complete();
        var domAdmission = Interlocked.Exchange(ref _pageProjectionInputAdmission, null);
        domAdmission?.Complete();
        _mux.Dispose();
    }

    private bool IsReleased => Volatile.Read(ref _released) != 0;

    // ── Caller attachment ────────────────────────────────────────────────────

    public IResult<Guid> Attach(IAttachedSessionClient client)
    {
        ArgumentNullException.ThrowIfNull(client);

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

            var attachedId = Guid.CreateVersion7();
            _attachmentId = attachedId;
            _attachedClient = client;
            _collector.AddRef(SessionId);
            _mux.SetAttachedConsumer(attachedId);
            return Result<Guid>.Success(attachedId);
        }
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
            _mux.SetAttachedConsumer(null);
            return Result.Success();
        }
    }

    public IResult ObserveSessionNotifications(INotificationStream stream)
    {
        ArgumentNullException.ThrowIfNull(stream);

        ChannelReader<SessionNotification> featureReader;
        CancellationToken lifetimeToken;

        lock (_attachmentGate)
        {
            if (IsReleased)
            {
                return Result.Failure("Live session is released");
            }

            if (_featureNotifications is not null)
            {
                return Result.Failure("Session notifications are already observed");
            }

            if (!TryGetLifetimeToken(out lifetimeToken))
            {
                return Result.Failure("Live session is released");
            }

            var channel = stream.GetNotificationChannel();
            if (channel.IsFailure)
            {
                return Result.Failure(channel.Errors.ToArray());
            }

            _featureNotifications = stream;
            featureReader = channel.Value;
        }

        var loop = RunFeatureLoopAsync(featureReader, lifetimeToken);
        _featureLoop = loop;
        ObserveFeatureLoop(loop);
        return Result.Success();
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
                case SessionNotificationKind.PageProjectionIntentRejected:
                    _telemetry.PageProjection.Input.Rejected(
                        notification.ErrorCode,
                        notification.Message,
                        notification.Phase,
                        notification.DomGeneration,
                        notification.DomAnchor,
                        notification.TraceId,
                        notification.ClientTimestampMs);
                    break;
                case SessionNotificationKind.PageProjectionIntentApplied:
                    if (!string.IsNullOrWhiteSpace(notification.InputKind))
                    {
                        _telemetry.PageProjection.Input.Applied(
                            notification.InputKind.Trim(),
                            notification.Phase,
                            notification.DomGeneration,
                            notification.DomAnchor,
                            notification.TraceId,
                            notification.ClientTimestampMs);
                    }

                    break;
                case SessionNotificationKind.PageProjectionIntentPathTrace:
                    if (string.IsNullOrWhiteSpace(notification.InputKind)
                        || string.IsNullOrWhiteSpace(notification.Phase))
                    {
                        break;
                    }

                    var domKind = notification.InputKind.Trim();
                    switch (notification.Phase.Trim())
                    {
                        case "data_plane_received":
                            _telemetry.PageProjection.Input.DataPlaneReceived(
                                domKind,
                                notification.DomGeneration,
                                notification.DomAnchor,
                                notification.TraceId,
                                notification.ClientTimestampMs);
                            break;
                        case "grpc_pushed":
                            _telemetry.PageProjection.Input.SidecarPushWritten(
                                domKind,
                                null,
                                notification.DomGeneration,
                                notification.DomAnchor,
                                notification.TraceId,
                                notification.ClientTimestampMs);
                            break;
                        case "sidecar_admitted":
                            _telemetry.PageProjection.Input.SidecarAdmitted(
                                domKind,
                                notification.DomGeneration,
                                notification.DomAnchor,
                                notification.TraceId,
                                notification.ClientTimestampMs);
                            break;
                        case "cdp_dropped":
                            _telemetry.PageProjection.Input.CdpDropped(
                                domKind,
                                notification.Reason,
                                notification.DomGeneration,
                                notification.DomAnchor,
                                notification.TraceId,
                                notification.ClientTimestampMs);
                            break;
                    }

                    break;
                case SessionNotificationKind.PageProjectionDiffFrame:
                case SessionNotificationKind.PageProjectionDiffQueueDropped:
                    // FR/QD journal via IPageProjectionDiffTelemetry (direct), not DropOldest notifications.
                    break;
                case SessionNotificationKind.PageProjectionLifecycle:
                    if (string.Equals(notification.Phase, "queue_dropped", StringComparison.Ordinal))
                    {
                        // Client-visible QD (and sidecar bridge) journals via Diff telemetry
                        // on ReportPageProjectionDiffQueueDropped — do not double-journal here.
                        break;
                    }

                    if (string.Equals(notification.Phase, "soft_nav_observed", StringComparison.Ordinal))
                    {
                        _telemetry.PageProjection.Diff.SoftNavObserved(
                            notification.DomGeneration ?? 0,
                            notification.Url,
                            notification.Reason,
                            string.Equals(notification.PageProjectionDiffOperation, "armed", StringComparison.Ordinal));
                        break;
                    }

                    if (string.Equals(notification.Phase, "scroll_echo_hit", StringComparison.Ordinal))
                    {
                        double? sx = null, sy = null, st = null, sl = null;
                        var coords = notification.Reason?.Split(',');
                        if (coords is { Length: 2 }
                            && double.TryParse(coords[0], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var a)
                            && double.TryParse(coords[1], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var b))
                        {
                            if (string.Equals(notification.InputKind, "viewport", StringComparison.Ordinal))
                            {
                                sx = a;
                                sy = b;
                            }
                            else
                            {
                                st = a;
                                sl = b;
                            }
                        }

                        _telemetry.PageProjection.Input.ScrollEchoHit(
                            notification.InputKind ?? "viewport",
                            notification.DomGeneration,
                            notification.DomAnchor,
                            sx,
                            sy,
                            st,
                            sl);
                        break;
                    }

                    if (notification.Phase is { Length: > 0 } phase
                        && phase.StartsWith("parity_", StringComparison.Ordinal)
                        && !string.IsNullOrWhiteSpace(notification.PayloadJson))
                    {
                        try
                        {
                            PageProjectionParityTelemetryJournal.TryJournal(
                                _journalCatalog,
                                _telemetry.PageProjection,
                                phase,
                                notification.PayloadJson!);
                        }
                        catch (Exception journalEx)
                        {
                            _logger.LogWarning(
                                journalEx,
                                "Session {SessionId} failed to journal PageEpoch parity phase {Phase}.",
                                SessionId,
                                phase);
                        }

                        break;
                    }

                    if (!string.Equals(notification.Phase, "generation_bumped", StringComparison.Ordinal)
                        || string.IsNullOrWhiteSpace(notification.Reason))
                    {
                        break;
                    }

                    _telemetry.PageProjection.Diff.GenerationBumped(
                        notification.DomFromGeneration ?? 0,
                        notification.DomGeneration ?? 0,
                        notification.Reason.Trim(),
                        notification.Url,
                        notification.PageProjectionDiffPlane);
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

    public IResult<IFrameStream> OpenFrameStream(Guid consumerId)
    {
        if (_mirrorMode != MirrorMode.VideoStreaming)
        {
            return Result<IFrameStream>.Failure(SessionMirrorErrors.VideoStreamingRequiredMessage);
        }

        return OpenStream(
            consumerId,
            OutputStreamKind.Frame,
            static (id, owner, mux) => (IFrameStream)new FrameStream(id, owner, mux));
    }

    public IResult<IPageProjectionDiffStream> OpenPageProjectionDiffStream(Guid consumerId)
    {
        if (_mirrorMode != MirrorMode.PageProjection)
        {
            return Result<IPageProjectionDiffStream>.Failure(SessionMirrorErrors.PageProjectionRequiredMessage);
        }

        return OpenStream(
            consumerId,
            OutputStreamKind.PageProjectionDiff,
            static (id, owner, mux) => (IPageProjectionDiffStream)new PageProjectionDiffStream(id, owner, mux));
    }

    public IResult<IConsoleOutputStream> OpenConsoleOutputStream(Guid consumerId)
        => OpenStream(
            consumerId,
            OutputStreamKind.Console,
            static (id, owner, mux) => (IConsoleOutputStream)new ConsoleOutputStream(id, owner, mux));

    public IResult<INotificationStream> OpenNotificationStream(Guid consumerId)
        => OpenStream(
            consumerId,
            OutputStreamKind.Notification,
            static (id, owner, mux) => (INotificationStream)new NotificationStream(id, owner, mux));

    public IResult<Task> ConsumeVideoStreamingInputAsync(
        Guid consumerId,
        ChannelReader<VideoStreamingInput> channelReader,
        CancellationToken ct = default)
    {
        if (_mirrorMode != MirrorMode.VideoStreaming)
        {
            return Result<Task>.Failure(SessionMirrorErrors.VideoStreamingRequiredMessage);
        }

        return StartInputPump(
            consumerId,
            (id, token) => _mux.StartVideoStreamingInputPump(id, channelReader, token),
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

    public IResult AdmitPageProjectionInput(PageProjectionIntent input)
    {
        ArgumentNullException.ThrowIfNull(input);
        if (_mirrorMode != MirrorMode.PageProjection)
        {
            return Result.Failure(SessionMirrorErrors.PageProjectionRequiredMessage);
        }

        if (string.IsNullOrWhiteSpace(input.Type))
        {
            return Result.Failure("PageProjectionIntent type is required");
        }

        var ensure = EnsurePageProjectionIntentAdmission();
        if (ensure.IsFailure)
        {
            return ensure;
        }

        var admission = Volatile.Read(ref _pageProjectionInputAdmission);
        if (admission is null)
        {
            return Result.Failure("Dom projection input admission is not ready");
        }

        admission.Admit(new PageProjectionIntent
        {
            Generation = input.Generation,
            Type = input.Type.Trim(),
            Anchor = input.Anchor,
            TimestampClient = input.TimestampClient,
            TraceId = input.TraceId,
            Payload = string.IsNullOrWhiteSpace(input.Payload) ? "{}" : input.Payload,
        }, out var dropped);

        if (dropped is not null
            && _journalCatalog.IsTypeEnabled(TelemetryJournalFacts.PageProjectionIntentAdmissionDropped))
        {
            long? clientTs = dropped.TimestampClient is { } ts && double.IsFinite(ts)
                ? (long)Math.Round(ts)
                : null;
            _telemetry.PageProjection.Input.AdmissionDropped(
                dropped.Type,
                dropped.Generation,
                dropped.Anchor,
                dropped.TraceId,
                clientTs);
        }

        return Result.Success();
    }

    public IResult<Task> ConsumePageProjectionIntentAsync(
        ChannelReader<PageProjectionIntent> channelReader,
        CancellationToken ct = default)
    {
        if (_mirrorMode != MirrorMode.PageProjection)
        {
            return Result<Task>.Failure(SessionMirrorErrors.PageProjectionRequiredMessage);
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
        var pump = _connection.ConsumePageProjectionIntentAsync(channelReader);
        if (pump.IsFailure)
        {
            linked.Dispose();
            return pump;
        }

        return Result<Task>.Success(ObservePageProjectionPumpAsync(pump.Value, linked));
    }

    public IResult<Task> ConsumeConsoleInputAsync(
        Guid consumerId,
        ChannelReader<ConsoleInput> channelReader,
        CancellationToken ct = default)
        => StartInputPump(
            consumerId,
            (id, token) => _mux.StartConsoleInputPump(id, channelReader, token),
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

    public void TracePageProjectionIntentDataPlaneReceived(
        string kind,
        long? generation,
        string? anchor,
        string? traceId = null,
        long? clientTimestampMs = null)
    {
        if (string.IsNullOrWhiteSpace(kind)
            || !_journalCatalog.IsTypeEnabled(TelemetryJournalFacts.PageProjectionIntentDataPlaneReceived))
        {
            return;
        }

        try
        {
            _telemetry.PageProjection.Input.DataPlaneReceived(
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
                "Session {SessionId} failed to journal Telemetry.Sessions.PageProjection.Input.DataPlaneReceived.",
                SessionId);
        }
    }

    public void TracePageProjectionDiffWireDelivered(
        PageProjectionDiff diff,
        long durationMs = 0,
        Guid streamId = default,
        Guid consumerId = default,
        long diffEpoch = 0)
    {
        if (!_journalCatalog.IsTypeEnabled(TelemetryJournalFacts.PageProjectionDiffWireDelivered))
        {
            return;
        }

        if (string.IsNullOrWhiteSpace(diff.Plane) || string.IsNullOrWhiteSpace(diff.Operation))
        {
            return;
        }

        try
        {
            _telemetry.PageProjection.Diff.WireDelivered(
                diff.Plane.Trim(),
                diff.Operation.Trim(),
                diff.Sequence,
                diff.Generation,
                diff.Timestamp,
                durationMs,
                streamId,
                consumerId,
                diffEpoch);
        }
        catch (Exception journalEx)
        {
            _logger.LogWarning(
                journalEx,
                "Session {SessionId} failed to journal Telemetry.Sessions.PageProjection.Diff.WireDelivered.",
                SessionId);
        }
    }

    public bool IsPageProjectionDiffWireDeliveredEnabled()
        => _journalCatalog.IsTypeEnabled(TelemetryJournalFacts.PageProjectionDiffWireDelivered);

    public void TracePageProjectionDiffFanOutEnqueued(
        PageProjectionDiff diff,
        long waitMs,
        Guid streamId,
        Guid consumerId,
        string kind,
        int targetIndex,
        int targetCount,
        int diffChannelCount,
        long diffEpoch)
    {
        if (!_journalCatalog.IsTypeEnabled(TelemetryJournalFacts.PageProjectionDiffFanOutEnqueued))
        {
            return;
        }

        if (string.IsNullOrWhiteSpace(diff.Plane)
            || string.IsNullOrWhiteSpace(diff.Operation)
            || string.IsNullOrWhiteSpace(kind))
        {
            return;
        }

        TracePageProjectionDiffFanOutEnqueuedCore(
            diff.Plane.Trim(),
            diff.Operation.Trim(),
            diff.Sequence,
            diff.Generation,
            diff.Timestamp,
            waitMs,
            streamId,
            consumerId,
            kind.Trim(),
            targetIndex,
            targetCount,
            diffChannelCount,
            diffEpoch);
    }

    internal void TracePageProjectionDiffFanOutEnqueuedCore(
        string plane,
        string operation,
        long sequence,
        long generation,
        long timestamp,
        long waitMs,
        Guid streamId,
        Guid consumerId,
        string kind,
        int targetIndex,
        int targetCount,
        int diffChannelCount,
        long diffEpoch)
    {
        if (!_journalCatalog.IsTypeEnabled(TelemetryJournalFacts.PageProjectionDiffFanOutEnqueued))
        {
            return;
        }

        try
        {
            _telemetry.PageProjection.Diff.FanOutEnqueued(
                plane,
                operation,
                sequence,
                generation,
                timestamp,
                waitMs,
                streamId,
                consumerId,
                kind,
                targetIndex,
                targetCount,
                diffChannelCount,
                diffEpoch);
        }
        catch (Exception journalEx)
        {
            _logger.LogWarning(
                journalEx,
                "Session {SessionId} failed to journal Telemetry.Sessions.PageProjection.Diff.FanOutEnqueued.",
                SessionId);
        }
    }

    public void TracePageProjectionDiffStreamDequeued(
        PageProjectionDiff diff,
        Guid streamId = default,
        Guid consumerId = default,
        long diffEpoch = 0)
    {
        if (!_journalCatalog.IsTypeEnabled(TelemetryJournalFacts.PageProjectionDiffStreamDequeued))
        {
            return;
        }

        if (string.IsNullOrWhiteSpace(diff.Plane) || string.IsNullOrWhiteSpace(diff.Operation))
        {
            return;
        }

        try
        {
            _telemetry.PageProjection.Diff.StreamDequeued(
                diff.Plane.Trim(),
                diff.Operation.Trim(),
                diff.Sequence,
                diff.Generation,
                diff.Timestamp,
                streamId,
                consumerId,
                diffEpoch);
        }
        catch (Exception journalEx)
        {
            _logger.LogWarning(
                journalEx,
                "Session {SessionId} failed to journal Telemetry.Sessions.PageProjection.Diff.StreamDequeued.",
                SessionId);
        }
    }

    public void TracePageProjectionDiffOutputStreamOpened(
        Guid streamId,
        Guid consumerId,
        string kind,
        int openStreamCount,
        int diffChannelCapacity)
    {
        if (!_journalCatalog.IsTypeEnabled(TelemetryJournalFacts.PageProjectionDiffOutputStreamOpened))
        {
            return;
        }

        if (string.IsNullOrWhiteSpace(kind))
        {
            return;
        }

        try
        {
            _telemetry.PageProjection.Diff.OutputStreamOpened(
                streamId,
                consumerId,
                kind.Trim(),
                openStreamCount,
                diffChannelCapacity);
        }
        catch (Exception journalEx)
        {
            _logger.LogWarning(
                journalEx,
                "Session {SessionId} failed to journal Telemetry.Sessions.PageProjection.Diff.OutputStreamOpened.",
                SessionId);
        }
    }

    public void TracePageProjectionDiffOutputStreamClosed(
        Guid streamId,
        Guid consumerId,
        string kind,
        int openStreamCount)
    {
        if (!_journalCatalog.IsTypeEnabled(TelemetryJournalFacts.PageProjectionDiffOutputStreamClosed))
        {
            return;
        }

        if (string.IsNullOrWhiteSpace(kind))
        {
            return;
        }

        try
        {
            _telemetry.PageProjection.Diff.OutputStreamClosed(
                streamId,
                consumerId,
                kind.Trim(),
                openStreamCount);
        }
        catch (Exception journalEx)
        {
            _logger.LogWarning(
                journalEx,
                "Session {SessionId} failed to journal Telemetry.Sessions.PageProjection.Diff.OutputStreamClosed.",
                SessionId);
        }
    }

    public void TracePageProjectionDiffFrameReceived(PageProjectionDiff diff)
    {
        if (!_journalCatalog.IsTypeEnabled(TelemetryJournalFacts.PageProjectionDiffFrameReceived))
        {
            return;
        }

        if (string.IsNullOrWhiteSpace(diff.Plane) || string.IsNullOrWhiteSpace(diff.Operation))
        {
            return;
        }

        int? sheetCount = null;
        int? ruleCount = null;
        int? seededSheetCount = null;
        if (diff.Install?.Sheets is { Count: > 0 } sheets)
        {
            sheetCount = sheets.Count;
            var rules = 0;
            var seeded = 0;
            foreach (var sheet in sheets)
            {
                rules += sheet.Rules?.Count ?? 0;
                if (sheet.Rules is { Count: > 0 }
                    && sheet.Rules.Exists(r => r.Id.StartsWith("seed:", StringComparison.Ordinal)))
                {
                    seeded++;
                }
            }

            ruleCount = rules;
            seededSheetCount = seeded;
        }
        else if (diff.SheetList?.Added is { Count: > 0 } added)
        {
            sheetCount = added.Count;
            var rules = 0;
            var seeded = 0;
            foreach (var entry in added)
            {
                rules += entry.Sheet?.Rules?.Count ?? 0;
                if (entry.Sheet?.Rules is { Count: > 0 }
                    && entry.Sheet.Rules.Exists(r => r.Id.StartsWith("seed:", StringComparison.Ordinal)))
                {
                    seeded++;
                }
            }

            ruleCount = rules;
            seededSheetCount = seeded;
        }

        TracePageProjectionDiffFrameReceivedCore(
            diff.Plane.Trim(),
            diff.Operation.Trim(),
            diff.Sequence,
            diff.Generation,
            diff.Timestamp,
            sheetCount,
            ruleCount,
            seededSheetCount);
    }

    private void TracePageProjectionDiffFrameReceivedCore(
        string plane,
        string operation,
        long sequence,
        long generation,
        long timestamp,
        int? sheetCount,
        int? ruleCount,
        int? seededSheetCount)
    {
        if (!_journalCatalog.IsTypeEnabled(TelemetryJournalFacts.PageProjectionDiffFrameReceived))
        {
            return;
        }

        try
        {
            _telemetry.PageProjection.Diff.FrameReceived(
                plane,
                operation,
                sequence,
                generation,
                timestamp,
                sheetCount,
                ruleCount,
                seededSheetCount);
        }
        catch (Exception journalEx)
        {
            _logger.LogWarning(
                journalEx,
                "Session {SessionId} failed to journal Telemetry.Sessions.PageProjection.Diff.FrameReceived.",
                SessionId);
        }
    }

    public void TracePageProjectionDiffQueueDropped(
        string stage,
        int droppedCount,
        int capacity,
        long? sequence = null,
        long? generation = null,
        string? plane = null,
        string? operation = null,
        long? lowestDroppedSequence = null,
        long? highestDroppedSequence = null,
        string? reason = null,
        Guid? streamId = null,
        Guid? consumerId = null,
        string? kind = null,
        int? targetCount = null,
        int? diffChannelCount = null,
        long? diffEpoch = null)
    {
        if (droppedCount <= 0
            || string.IsNullOrWhiteSpace(stage)
            || !_journalCatalog.IsTypeEnabled(TelemetryJournalFacts.PageProjectionDiffQueueDropped))
        {
            return;
        }

        try
        {
            _telemetry.PageProjection.Diff.QueueDropped(
                stage.Trim(),
                droppedCount,
                capacity,
                sequence,
                generation,
                plane,
                operation,
                lowestDroppedSequence,
                highestDroppedSequence,
                reason,
                streamId,
                consumerId,
                kind,
                targetCount,
                diffChannelCount,
                diffEpoch);
        }
        catch (Exception journalEx)
        {
            _logger.LogWarning(
                journalEx,
                "Session {SessionId} failed to journal Telemetry.Sessions.PageProjection.Diff.QueueDropped.",
                SessionId);
        }
    }

    public void ReportPageProjectionDiffQueueDropped(
        string stage,
        int droppedCount,
        int capacity,
        long? sequence = null,
        long? generation = null,
        string? plane = null,
        string? operation = null,
        long? lowestDroppedSequence = null,
        long? highestDroppedSequence = null,
        string? reason = null,
        Guid? streamId = null,
        Guid? consumerId = null,
        string? kind = null,
        int? targetCount = null,
        int? diffChannelCount = null,
        long? diffEpoch = null)
        => _connection.ReportPageProjectionDiffQueueDropped(
            stage,
            droppedCount,
            capacity,
            sequence,
            generation,
            plane,
            operation,
            lowestDroppedSequence,
            highestDroppedSequence,
            reason,
            streamId,
            consumerId,
            kind,
            targetCount,
            diffChannelCount,
            diffEpoch);

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
        Guid consumerId;
        lock (_attachmentGate)
        {
            if (_attachmentId is not Guid attached)
            {
                Volatile.Write(ref _videoStreamingInputAdmission, null);
                Interlocked.Exchange(ref _videoStreamingInputAdmissionStarted, 0);
                admission.Complete();
                return Result.Failure("No client attached");
            }

            consumerId = attached;
        }

        var pump = ConsumeVideoStreamingInputAsync(consumerId, admission.Reader);
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

    private IResult EnsurePageProjectionIntentAdmission()
    {
        if (IsReleased)
        {
            return Result.Failure("Live session is released");
        }

        if (Interlocked.CompareExchange(ref _pageProjectionInputAdmissionStarted, 1, 0) != 0)
        {
            var spun = 0;
            while (Volatile.Read(ref _pageProjectionInputAdmission) is null && !IsReleased && spun < 200)
            {
                Thread.SpinWait(20);
                spun++;
            }

            return Volatile.Read(ref _pageProjectionInputAdmission) is null
                ? Result.Failure("Dom projection input admission failed to start")
                : Result.Success();
        }

        var admission = PageProjectionIntentAdmissionChannel.Create();
        Volatile.Write(ref _pageProjectionInputAdmission, admission);
        var pump = ConsumePageProjectionIntentAsync(admission.Reader);
        if (pump.IsFailure)
        {
            Volatile.Write(ref _pageProjectionInputAdmission, null);
            Interlocked.Exchange(ref _pageProjectionInputAdmissionStarted, 0);
            return Result.Failure(pump.Errors.ToArray());
        }

        _ = ObserveAdmissionPumpAsync(pump.Value);
        return Result.Success();
    }

    private async Task ObservePageProjectionPumpAsync(Task pump, CancellationTokenSource linked)
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
        if (_mirrorMode != MirrorMode.PageProjection)
        {
            return Result<DomAsset>.Failure(SessionMirrorErrors.PageProjectionRequiredMessage);
        }

        if (string.IsNullOrWhiteSpace(key))
        {
            return Result<DomAsset>.Failure("Asset key is required");
        }

        if (IsReleased || !_connection.IsOpen)
        {
            return Result<DomAsset>.Failure("Live session is released");
        }

        var trimmed = key.Trim();

        // §5.12.2 — only a plain, non-Range "asset" GET (never blob/data, which are
        // session-synthesized, never origin subresources) is ever L2-eligible.
        var l2Key = IsSharedAssetCacheEligible(kind, rangeHeader)
            ? SharedAssetCacheL2.BuildKey("asset", trimmed, 0, "", "", [], "none")
            : null;
        if (l2Key is not null)
        {
            using var hit = _sharedAssetCacheL2.TryAcquire(l2Key);
            if (hit is not null)
            {
                return Result<DomAsset>.Success(new DomAsset
                {
                    Body = hit.Body,
                    ContentType = hit.ContentType,
                    StatusCode = hit.StatusCode,
                });
            }
        }

        var started = Environment.TickCount64;
        var result = await _connection
            .GetDomAssetAsync(trimmed, ct, kind, rangeHeader)
            .ConfigureAwait(false);
        var durationMs = Math.Max(0, Environment.TickCount64 - started);
        var urlKey = DomAssetUrlKey(trimmed);

        if (l2Key is not null && result.IsSuccess)
        {
            TryPutSharedAssetCache(l2Key, result.Value);
        }

        try
        {
            var miss = result.IsFailure
                || (result.IsSuccess
                    && result.Value.Body.Length == 0
                    && result.Value.StatusCode is 0 or 404);
            if (miss && _journalCatalog.IsTypeEnabled(TelemetryJournalFacts.PageProjectionAssetServeMiss))
            {
                var status = result.IsSuccess ? result.Value.StatusCode : 404;
                _telemetry.PageProjection.Asset.ServeMiss(urlKey, durationMs, status <= 0 ? 404 : status);
            }
            else if (!miss
                && durationMs >= 200
                && _journalCatalog.IsTypeEnabled(TelemetryJournalFacts.PageProjectionAssetServeSlow))
            {
                var status = result.Value.StatusCode is >= 200 and < 600 ? result.Value.StatusCode : 200;
                _telemetry.PageProjection.Asset.ServeSlow(urlKey, durationMs, status);
            }
        }
        catch (Exception journalEx)
        {
            _logger.LogWarning(
                journalEx,
                "Session {SessionId} failed to journal PageProjection Asset serve telemetry.",
                SessionId);
        }

        return result;
    }

    /// <summary>
    /// §5.12.2 — pass-through (media/Range) and session-synthesized blob/data keys never
    /// carry an origin-shareable byte identity and must stay L1-only (task-mandated exclusion).
    /// </summary>
    private static bool IsSharedAssetCacheEligible(string? kind, string? rangeHeader)
    {
        if (!string.IsNullOrEmpty(rangeHeader))
        {
            return false;
        }

        return string.IsNullOrEmpty(kind) || string.Equals(kind, "asset", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Stores a freshly fetched asset in the host-wide L2 tier when the §5.12.2.1 predicate
    /// allows it. A non-empty <c>Vary</c> is kept L1-only: the pre-fetch <see cref="ISharedAssetCacheL2.TryAcquire"/>
    /// lookup above has no request-time knowledge of which header values a not-yet-seen
    /// response will vary on, so a vary-less key is the only one a later lookup can ever
    /// address — storing under a vary-qualified key would silently orphan the entry
    /// (never found, never evicted) rather than risk a wrong cross-session hit (PP-ASSET-7).
    /// </summary>
    private void TryPutSharedAssetCache(string l2Key, DomAsset asset)
    {
        if (!_sharedAssetCacheL2.Enabled
            || asset.PassThrough
            || asset.Body.Length == 0
            || !string.IsNullOrWhiteSpace(asset.Vary))
        {
            return;
        }

        var descriptor = new SharedAssetShareabilityDescriptor
        {
            RequestHadCookie = asset.RequestHadCookie,
            RequestHadAuthorization = asset.RequestHadAuthorization,
            CacheControlDirectives = SplitHeaderList(asset.CacheControl),
            VaryValues = [],
            StatusCode = asset.StatusCode,
            Kind = SharedAssetRequestKind.Subresource,
        };

        if (!SharedAssetCacheL2.IsShareable(descriptor))
        {
            return;
        }

        _sharedAssetCacheL2.Put(l2Key, asset.Body, asset.ContentType, asset.StatusCode).Dispose();
    }

    private static IReadOnlyCollection<string> SplitHeaderList(string? raw) =>
        string.IsNullOrWhiteSpace(raw)
            ? []
            : raw.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);

    private static string DomAssetUrlKey(string key)
    {
        var q = key.IndexOf('?', StringComparison.Ordinal);
        var h = key.IndexOf('#', StringComparison.Ordinal);
        var cut = key.Length;
        if (q >= 0) cut = Math.Min(cut, q);
        if (h >= 0) cut = Math.Min(cut, h);
        return cut < key.Length ? key[..cut] : key;
    }

    public async Task<IResult<PageProjectionResyncSnapshot>> GetPageProjectionResyncAsync(
        long generation,
        long sequence,
        CancellationToken ct = default)
    {
        if (_mirrorMode != MirrorMode.PageProjection)
        {
            return Result<PageProjectionResyncSnapshot>.Failure(
                SessionMirrorErrors.PageProjectionRequiredMessage);
        }

        if (IsReleased || !_connection.IsOpen)
        {
            return Result<PageProjectionResyncSnapshot>.Failure("Live session is released");
        }

        if (_journalCatalog.IsTypeEnabled(TelemetryJournalFacts.PageProjectionDiffResyncRequested))
        {
            try
            {
                _telemetry.PageProjection.Diff.ResyncRequested(generation, sequence);
            }
            catch (Exception journalEx)
            {
                _logger.LogWarning(
                    journalEx,
                    "Session {SessionId} failed to journal Telemetry.Sessions.PageProjection.Diff.ResyncRequested.",
                    SessionId);
            }
        }

        var started = Environment.TickCount64;
        var result = await _connection
            .GetPageProjectionResyncAsync(generation, sequence, ct)
            .ConfigureAwait(false);
        if (result.IsFailure)
        {
            return result;
        }

        if (_journalCatalog.IsTypeEnabled(TelemetryJournalFacts.PageProjectionDiffResyncServed))
        {
            try
            {
                // Binary §5.7.2 resync — sheet/rule counts are not JSON-parsed (PP-WIRE-1).
                // Report part count in SheetCount so telemetry still has a size signal.
                var partCount = result.Value.FrameParts.Count;
                _telemetry.PageProjection.Diff.ResyncServed(
                    result.Value.Generation,
                    result.Value.CoversThroughSequence,
                    partCount,
                    0,
                    0,
                    Math.Max(0, Environment.TickCount64 - started),
                    result.Value.PageEpochId,
                    result.Value.Source,
                    result.Value.DomMapMs,
                    result.Value.CssomCloneMs,
                    result.Value.RewriteMs,
                    result.Value.SerializeMs);
            }
            catch (Exception journalEx)
            {
                _logger.LogWarning(
                    journalEx,
                    "Session {SessionId} failed to journal Telemetry.Sessions.PageProjection.Diff.ResyncServed.",
                    SessionId);
            }
        }

        return result;
    }

    private static (int SheetCount, int RuleCount, int SeededSheetCount) CountCssomSheets(byte[] sheetsJson)
    {
        if (sheetsJson is not { Length: > 0 })
        {
            return (0, 0, 0);
        }

        try
        {
            using var doc = System.Text.Json.JsonDocument.Parse(sheetsJson);
            if (doc.RootElement.ValueKind != System.Text.Json.JsonValueKind.Array)
            {
                return (0, 0, 0);
            }

            var sheets = 0;
            var rules = 0;
            var seeded = 0;
            foreach (var sheet in doc.RootElement.EnumerateArray())
            {
                sheets++;
                if (!sheet.TryGetProperty("rules", out var rulesEl)
                    || rulesEl.ValueKind != System.Text.Json.JsonValueKind.Array)
                {
                    continue;
                }

                var sheetSeeded = false;
                foreach (var rule in rulesEl.EnumerateArray())
                {
                    rules++;
                    if (!sheetSeeded
                        && rule.TryGetProperty("id", out var idEl)
                        && idEl.ValueKind == System.Text.Json.JsonValueKind.String
                        && idEl.GetString()?.StartsWith("seed:", StringComparison.Ordinal) == true)
                    {
                        sheetSeeded = true;
                    }
                }

                if (sheetSeeded) seeded++;
            }

            return (sheets, rules, seeded);
        }
        catch
        {
            return (0, 0, 0);
        }
    }

    public async Task<IResult> PutDomUploadAsync(
        string uploadId,
        byte[] body,
        string contentType,
        string name,
        CancellationToken ct = default)
    {
        if (_mirrorMode != MirrorMode.PageProjection)
        {
            return Result.Failure(SessionMirrorErrors.PageProjectionRequiredMessage);
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

    public async Task<IResult> ReportPageProjectionClientStateAsync(
        PageProjectionClientStateReport report,
        CancellationToken ct = default)
    {
        if (_mirrorMode != MirrorMode.PageProjection)
        {
            return Result.Failure(SessionMirrorErrors.PageProjectionRequiredMessage);
        }

        if (IsReleased || !_connection.IsOpen)
        {
            return Result.Failure("Live session is released");
        }

        return await _connection
            .ReportPageProjectionClientStateAsync(report, ct)
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
        Guid consumerId,
        OutputStreamKind kind,
        Func<Guid, Guid, ISessionStreamMultiplexer, TStream> create)
    {
        if (IsReleased)
        {
            return Result<TStream>.Failure("Live session is released");
        }

        if (consumerId == Guid.Empty)
        {
            return Result<TStream>.Failure("Consumer id is required");
        }

        var id = Guid.CreateVersion7();
        var register = _mux.RegisterOutputStream(consumerId, id, kind);
        if (register.IsFailure)
        {
            return Result<TStream>.Failure(register.Errors.ToArray());
        }

        return Result<TStream>.Success(create(id, consumerId, _mux));
    }

    private IResult<Task> StartInputPump(
        Guid consumerId,
        Func<Guid, CancellationToken, IResult<Task>> start,
        CancellationToken ct)
    {
        if (IsReleased)
        {
            return Result<Task>.Failure("Live session is released");
        }

        if (consumerId == Guid.Empty)
        {
            return Result<Task>.Failure("Consumer id is required");
        }

        if (!TryGetLifetimeToken(out var lifetimeToken))
        {
            return Result<Task>.Failure("Live session is released");
        }

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
