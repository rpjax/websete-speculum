namespace Speculum.Api.BrowserClients;

/// <summary>
/// Lossless Diff journal sink bound by <c>LiveSession</c>.
/// FrameReceived / QueueDropped must not travel the DropOldest notification channel.
/// </summary>
public interface IPageProjectionDiffTelemetry
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
}
