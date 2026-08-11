namespace Speculum.Api.Telemetry.Events.Services.Contracts;

/// <summary>Telemetry hops for PageProjection Diff frames (sidecar → API → client).</summary>
public interface ISessionPageProjectionDiffTelemetryEvents
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
        string? diffKind = null);

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
        int? diffChannelCount = null,
        long? diffEpoch = null);

    void WireDelivered(
        string plane,
        string operation,
        long sequence,
        long generation,
        long timestamp,
        long durationMs,
        Guid streamId,
        Guid consumerId,
        long diffEpoch);

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
        int diffChannelCount,
        long diffEpoch);

    void StreamDequeued(
        string plane,
        string operation,
        long sequence,
        long generation,
        long timestamp,
        Guid streamId,
        Guid consumerId,
        long diffEpoch);

    void OutputStreamOpened(
        Guid streamId,
        Guid consumerId,
        string kind,
        int openStreamCount,
        int diffChannelCapacity);

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
}
