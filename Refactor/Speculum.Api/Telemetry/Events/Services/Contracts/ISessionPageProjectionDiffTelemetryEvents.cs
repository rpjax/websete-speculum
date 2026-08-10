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
        string? reason = null);

    void WireDelivered(
        string plane,
        string operation,
        long sequence,
        long generation,
        long timestamp);

    void ResyncRequested(long hintGeneration, long hintSequence);

    void ResyncServed(
        long generation,
        long coversThroughSequence,
        int sheetCount,
        int ruleCount,
        int seededSheetCount,
        long durationMs);
}
