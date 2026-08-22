namespace Speculum.Api.Telemetry.Events.Services.Contracts;

/// <summary>
/// PageProjection frame telemetry: wire hops (sidecar → API → client) plus rate/clock aggregates.
/// </summary>
public interface ISessionPageProjectionFrameTelemetryEvents
{
    void FrameReceived(
        string plane,
        string operation,
        long sequence,
        long generation,
        long timestamp,
        int? sheetCount = null,
        int? ruleCount = null,
        int? seededSheetCount = null);

    void GenerationBumped(
        long fromGeneration,
        long toGeneration,
        string reason,
        string? url = null,
        string? frameKind = null);

    void SoftNavObserved(
        long generation,
        string? url,
        string? documentEpoch,
        bool liveArmed);

    void QueueDropped(
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
        long? frameEpoch = null);

    void WireDelivered(
        string plane,
        string operation,
        long sequence,
        long generation,
        long timestamp,
        long durationMs,
        Guid streamId,
        Guid consumerId,
        long frameEpoch);

    void FanOutEnqueued(
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
        long frameEpoch);

    void StreamDequeued(
        string plane,
        string operation,
        long sequence,
        long generation,
        long timestamp,
        Guid streamId,
        Guid consumerId,
        long frameEpoch);

    void OutputStreamOpened(
        Guid streamId,
        Guid consumerId,
        string kind,
        int openStreamCount,
        int frameChannelCapacity);

    void OutputStreamClosed(
        Guid streamId,
        Guid consumerId,
        string kind,
        int openStreamCount);

    void ResyncRequested(long hintGeneration, long hintSequence);

    void ResyncServed(
        long generation,
        long coversThroughSequence,
        int sheetCount,
        int ruleCount,
        int seededSheetCount,
        long durationMs,
        string? pageEpochId = null,
        string? source = null,
        long domMapMs = 0,
        long cssomCloneMs = 0,
        long rewriteMs = 0,
        long serializeMs = 0);

    void RateChanged(string pageEpochId, long fromHz, long toHz, long generation);

    void ClockStalled(string pageEpochId, long sinceLastTickMs, long generation);

    void ApplyOverrun(string pageEpochId, long overrunCount, long queuedFrames, long generation);

    void Aggregate(
        string pageEpochId,
        long generation,
        long framesEmitted,
        long bytesEmitted,
        long rateHz,
        long stallCount,
        long applyOverrunReports,
        long mirrorBytes,
        long intervalMs,
        long tVirtualMs);
}

public interface ISessionPageProjectionPoolTelemetryEvents
{
    void PoolAcquired(int maxWidth, int maxHeight, int poolSize, long waitMs);
    void PoolReleased(long heldMs);
}
