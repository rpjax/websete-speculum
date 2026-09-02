using Speculum.Api.Sessions.Models;

namespace Speculum.Api.Sessions.Services;

internal sealed partial class LiveSession
{
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
                        case "cdp_applied":
                            _telemetry.PageProjection.Input.Applied(
                                domKind,
                                notification.Phase,
                                notification.DomGeneration,
                                notification.DomAnchor,
                                notification.TraceId,
                                notification.ClientTimestampMs);
                            break;
                        case "cdp_rejected":
                            _telemetry.PageProjection.Input.Rejected(
                                notification.ErrorCode,
                                notification.Message,
                                notification.Reason,
                                notification.DomGeneration,
                                notification.DomAnchor,
                                notification.TraceId,
                                notification.ClientTimestampMs);
                            break;
                    }

                    break;
                case SessionNotificationKind.PageProjectionFrame:
                case SessionNotificationKind.PageProjectionFrameQueueDropped:
                    // FR/QD journal via IPageProjectionFrameTelemetry (direct), not DropOldest notifications.
                    break;
                case SessionNotificationKind.PageProjectionLifecycle:
                    if (string.Equals(notification.Phase, "queue_dropped", StringComparison.Ordinal))
                    {
                        // Client-visible QD (and sidecar bridge) journals via Diff telemetry
                        // on ReportPageProjectionFrameQueueDropped — do not double-journal here.
                        break;
                    }

                    if (string.Equals(notification.Phase, "soft_nav_observed", StringComparison.Ordinal))
                    {
                        _telemetry.PageProjection.Frame.SoftNavObserved(
                            notification.DomGeneration ?? 0,
                            notification.Url,
                            notification.Reason,
                            string.Equals(notification.PageProjectionFrameOperation, "armed", StringComparison.Ordinal));
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

                    if (string.Equals(notification.Phase, "session_pool_acquired", StringComparison.Ordinal))
                    {
                        _telemetry.PageProjection.Pool.PoolAcquired(
                            notification.DisplayWidth ?? 0,
                            notification.DisplayHeight ?? 0,
                            notification.PoolSize ?? 0,
                            notification.PoolWaitMs ?? 0);
                        break;
                    }

                    if (string.Equals(notification.Phase, "session_pool_released", StringComparison.Ordinal))
                    {
                        _telemetry.PageProjection.Pool.PoolReleased(notification.PoolHeldMs ?? 0);
                        break;
                    }

                    if (!string.Equals(notification.Phase, "generation_bumped", StringComparison.Ordinal)
                        || string.IsNullOrWhiteSpace(notification.Reason))
                    {
                        break;
                    }

                    _telemetry.PageProjection.Frame.GenerationBumped(
                        notification.DomFromGeneration ?? 0,
                        notification.DomGeneration ?? 0,
                        notification.Reason.Trim(),
                        notification.Url,
                        notification.PageProjectionFramePlane);
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
}
