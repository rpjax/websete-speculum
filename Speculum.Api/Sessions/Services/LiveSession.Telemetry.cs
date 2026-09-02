using Speculum.Api.BrowserClients;
using Speculum.Api.Sessions.Mirror.PageProjection;
using Speculum.Api.Sessions.Services.Streaming;
using Speculum.Api.Telemetry;

namespace Speculum.Api.Sessions.Services;

internal sealed partial class LiveSession
{
    private sealed class FrameTelemetryBridge(LiveSession session) : IPageProjectionFrameTelemetry
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
            session.TracePageProjectionFrameReceivedCore(
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
            int? frameChannelCount = null,
            long? frameEpoch = null)
        {
            session.TracePageProjectionFrameQueueDropped(
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
                frameChannelCount,
                frameEpoch);
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
            int frameChannelCount,
            long frameEpoch)
        {
            session.TracePageProjectionFrameFanOutEnqueuedCore(
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
                frameChannelCount,
                frameEpoch);
        }

        public void OutputStreamOpened(
            Guid streamId,
            Guid consumerId,
            string kind,
            int openStreamCount,
            int frameChannelCapacity)
        {
            session.TracePageProjectionFrameOutputStreamOpened(
                streamId,
                consumerId,
                kind,
                openStreamCount,
                frameChannelCapacity);
        }

        public void OutputStreamClosed(
            Guid streamId,
            Guid consumerId,
            string kind,
            int openStreamCount)
        {
            session.TracePageProjectionFrameOutputStreamClosed(
                streamId,
                consumerId,
                kind,
                openStreamCount);
        }
    }

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

    public void TracePageProjectionIntentAdmissionFailed(
        string kind,
        long? generation,
        string? anchor,
        string errorCode,
        string message,
        string? traceId = null,
        long? clientTimestampMs = null)
    {
        _logger.LogWarning(
            "Session {SessionId} PageProjectionIntent admission failed: {ErrorCode} {Message} kind={Kind} generation={Generation} anchor={Anchor} traceId={TraceId}",
            SessionId,
            errorCode,
            message,
            kind,
            generation,
            anchor,
            traceId);

        if (string.IsNullOrWhiteSpace(kind)
            || !_journalCatalog.IsTypeEnabled(TelemetryJournalFacts.PageProjectionIntentRejected))
        {
            return;
        }

        try
        {
            _telemetry.PageProjection.Input.Rejected(
                errorCode,
                message,
                "admission",
                generation,
                anchor,
                traceId,
                clientTimestampMs);
        }
        catch (Exception journalEx)
        {
            _logger.LogWarning(
                journalEx,
                "Session {SessionId} failed to journal Telemetry.Sessions.PageProjection.Input.Rejected (admission).",
                SessionId);
        }
    }

    public void TracePageProjectionFrameWireDelivered(
        PageProjectionFrame diff,
        long durationMs = 0,
        Guid streamId = default,
        Guid consumerId = default,
        long frameEpoch = 0)
    {
        if (!_journalCatalog.IsTypeEnabled(TelemetryJournalFacts.PageProjectionFrameWireDelivered))
        {
            return;
        }

        if (string.IsNullOrWhiteSpace(diff.Plane) || string.IsNullOrWhiteSpace(diff.Operation))
        {
            return;
        }

        try
        {
            _telemetry.PageProjection.Frame.WireDelivered(
                diff.Plane.Trim(),
                diff.Operation.Trim(),
                diff.Sequence,
                diff.Generation,
                diff.Timestamp,
                durationMs,
                streamId,
                consumerId,
                frameEpoch);
        }
        catch (Exception journalEx)
        {
            _logger.LogWarning(
                journalEx,
                "Session {SessionId} failed to journal Telemetry.Sessions.PageProjection.Frame.WireDelivered.",
                SessionId);
        }
    }

    public bool IsPageProjectionFrameWireDeliveredEnabled()
        => _journalCatalog.IsTypeEnabled(TelemetryJournalFacts.PageProjectionFrameWireDelivered);

    public void TracePageProjectionFrameFanOutEnqueued(
        PageProjectionFrame diff,
        long waitMs,
        Guid streamId,
        Guid consumerId,
        string kind,
        int targetIndex,
        int targetCount,
        int frameChannelCount,
        long frameEpoch)
    {
        if (!_journalCatalog.IsTypeEnabled(TelemetryJournalFacts.PageProjectionFrameFanOutEnqueued))
        {
            return;
        }

        if (string.IsNullOrWhiteSpace(diff.Plane)
            || string.IsNullOrWhiteSpace(diff.Operation)
            || string.IsNullOrWhiteSpace(kind))
        {
            return;
        }

        TracePageProjectionFrameFanOutEnqueuedCore(
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
            frameChannelCount,
            frameEpoch);
    }

    internal void TracePageProjectionFrameFanOutEnqueuedCore(
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
        int frameChannelCount,
        long frameEpoch)
    {
        if (!_journalCatalog.IsTypeEnabled(TelemetryJournalFacts.PageProjectionFrameFanOutEnqueued))
        {
            return;
        }

        try
        {
            _telemetry.PageProjection.Frame.FanOutEnqueued(
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
                frameChannelCount,
                frameEpoch);
        }
        catch (Exception journalEx)
        {
            _logger.LogWarning(
                journalEx,
                "Session {SessionId} failed to journal Telemetry.Sessions.PageProjection.Frame.FanOutEnqueued.",
                SessionId);
        }
    }

    public void TracePageProjectionFrameStreamDequeued(
        PageProjectionFrame diff,
        Guid streamId = default,
        Guid consumerId = default,
        long frameEpoch = 0)
    {
        if (!_journalCatalog.IsTypeEnabled(TelemetryJournalFacts.PageProjectionFrameStreamDequeued))
        {
            return;
        }

        if (string.IsNullOrWhiteSpace(diff.Plane) || string.IsNullOrWhiteSpace(diff.Operation))
        {
            return;
        }

        try
        {
            _telemetry.PageProjection.Frame.StreamDequeued(
                diff.Plane.Trim(),
                diff.Operation.Trim(),
                diff.Sequence,
                diff.Generation,
                diff.Timestamp,
                streamId,
                consumerId,
                frameEpoch);
        }
        catch (Exception journalEx)
        {
            _logger.LogWarning(
                journalEx,
                "Session {SessionId} failed to journal Telemetry.Sessions.PageProjection.Frame.StreamDequeued.",
                SessionId);
        }
    }

    public void TracePageProjectionFrameOutputStreamOpened(
        Guid streamId,
        Guid consumerId,
        string kind,
        int openStreamCount,
        int frameChannelCapacity)
    {
        if (!_journalCatalog.IsTypeEnabled(TelemetryJournalFacts.PageProjectionFrameOutputStreamOpened))
        {
            return;
        }

        if (string.IsNullOrWhiteSpace(kind))
        {
            return;
        }

        try
        {
            _telemetry.PageProjection.Frame.OutputStreamOpened(
                streamId,
                consumerId,
                kind.Trim(),
                openStreamCount,
                frameChannelCapacity);
        }
        catch (Exception journalEx)
        {
            _logger.LogWarning(
                journalEx,
                "Session {SessionId} failed to journal Telemetry.Sessions.PageProjection.Frame.OutputStreamOpened.",
                SessionId);
        }
    }

    public void TracePageProjectionFrameOutputStreamClosed(
        Guid streamId,
        Guid consumerId,
        string kind,
        int openStreamCount)
    {
        if (!_journalCatalog.IsTypeEnabled(TelemetryJournalFacts.PageProjectionFrameOutputStreamClosed))
        {
            return;
        }

        if (string.IsNullOrWhiteSpace(kind))
        {
            return;
        }

        try
        {
            _telemetry.PageProjection.Frame.OutputStreamClosed(
                streamId,
                consumerId,
                kind.Trim(),
                openStreamCount);
        }
        catch (Exception journalEx)
        {
            _logger.LogWarning(
                journalEx,
                "Session {SessionId} failed to journal Telemetry.Sessions.PageProjection.Frame.OutputStreamClosed.",
                SessionId);
        }
    }

    public void TracePageProjectionFrameReceived(PageProjectionFrame diff)
    {
        if (!_journalCatalog.IsTypeEnabled(TelemetryJournalFacts.PageProjectionFrameReceived))
        {
            return;
        }

        var plane = string.IsNullOrWhiteSpace(diff.Plane) ? "binary" : diff.Plane.Trim();
        var operation = string.IsNullOrWhiteSpace(diff.Operation) ? "frame" : diff.Operation.Trim();

        int? sheetCount = null;
        int? ruleCount = null;
        int? seededSheetCount = null;

        TracePageProjectionFrameReceivedCore(
            plane,
            operation,
            diff.Sequence,
            diff.Generation,
            diff.Timestamp,
            sheetCount,
            ruleCount,
            seededSheetCount);
    }

    private void TracePageProjectionFrameReceivedCore(
        string plane,
        string operation,
        long sequence,
        long generation,
        long timestamp,
        int? sheetCount,
        int? ruleCount,
        int? seededSheetCount)
    {
        if (!_journalCatalog.IsTypeEnabled(TelemetryJournalFacts.PageProjectionFrameReceived))
        {
            return;
        }

        try
        {
            _telemetry.PageProjection.Frame.FrameReceived(
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
                "Session {SessionId} failed to journal Telemetry.Sessions.PageProjection.Frame.FrameReceived.",
                SessionId);
        }
    }

    public void TracePageProjectionFrameQueueDropped(
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
        int? frameChannelCount = null,
        long? frameEpoch = null)
    {
        if (droppedCount <= 0
            || string.IsNullOrWhiteSpace(stage)
            || !_journalCatalog.IsTypeEnabled(TelemetryJournalFacts.PageProjectionFrameQueueDropped))
        {
            return;
        }

        try
        {
            _telemetry.PageProjection.Frame.QueueDropped(
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
                frameChannelCount,
                frameEpoch);
        }
        catch (Exception journalEx)
        {
            _logger.LogWarning(
                journalEx,
                "Session {SessionId} failed to journal Telemetry.Sessions.PageProjection.Frame.QueueDropped.",
                SessionId);
        }
    }

    public void ReportPageProjectionFrameQueueDropped(
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
        int? frameChannelCount = null,
        long? frameEpoch = null)
        => _connection.ReportPageProjectionFrameQueueDropped(
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
            frameChannelCount,
            frameEpoch);

    public void TrySendConsumerPressure(ConsumerPressureSnapshot snapshot)
        => _connection.TrySendConsumerPressure(snapshot);
}
