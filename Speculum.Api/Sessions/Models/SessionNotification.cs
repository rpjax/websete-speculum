using MessagePack;

namespace Speculum.Api.Sessions.Models;

/// <summary>Kind of informative session notification from the sidecar / connection pumps.</summary>
public enum SessionNotificationKind
{
    LocationChanged = 1,
    MainFrameNavigationBlocked = 2,
    EditableFocusChanged = 3,
    /// <summary>True Chromium/session fault from sidecar <c>onCrash</c> — not transport.</summary>
    Crashed = 4,
    /// <summary>VideoStreamingInput rejected (screencast mirror plane).</summary>
    VideoStreamingInputRejected = 5,
    /// <summary>VideoStreamingInput pushed to sidecar successfully (opt-in journal).</summary>
    VideoStreamingInputApplied = 6,
    /// <summary>VideoStreamingInput path hop (phase = data_plane_received | grpc_pushed | sidecar_admitted).</summary>
    VideoStreamingInputPathTrace = 7,
    /// <summary>Opt-in allocation lifecycle from sidecar WatchAllocationLifecycle.</summary>
    AllocationLifecycle = 8,
    /// <summary>PageProjectionIntent rejected.</summary>
    PageProjectionIntentRejected = 9,
    /// <summary>PageProjectionIntent pushed to sidecar successfully (opt-in journal).</summary>
    PageProjectionIntentApplied = 10,
    /// <summary>
    /// PageProjectionIntent path hop
    /// (phase = data_plane_received | grpc_pushed | sidecar_admitted | cdp_dropped).
    /// </summary>
    PageProjectionIntentPathTrace = 11,
    /// <summary>PageProjectionFrame frame received from WatchPageProjectionFrames (opt-in journal).</summary>
    PageProjectionFrame = 12,
    /// <summary>PageProjection lifecycle (generation_bumped | queue_dropped) from WatchPageProjectionLifecycle.</summary>
    PageProjectionLifecycle = 13,
    /// <summary>API sequenced Diff channel DropAll (opt-in journal).</summary>
    PageProjectionFrameQueueDropped = 14,
}

/// <summary>
/// Fire-and-forget observation from the live browser (not request/response).
/// Consumed via <c>ISessionConnection.GetNotificationReader</c>.
/// </summary>
[MessagePackObject]
public sealed class SessionNotification
{
    [Key("kind")]
    public required SessionNotificationKind Kind { get; init; }

    /// <summary>URL for location / navigation-blocked kinds.</summary>
    [Key("url")]
    public string? Url { get; init; }

    /// <summary>Editable focus; null means blur for <see cref="SessionNotificationKind.EditableFocusChanged"/>.</summary>
    [Key("editing")]
    public EditingState? Editing { get; init; }

    [Key("errorCode")]
    public string? ErrorCode { get; init; }

    [Key("message")]
    public string? Message { get; init; }

    [Key("phase")]
    public string? Phase { get; init; }

    /// <summary>Wire input type for input applied / path-trace kinds.</summary>
    [Key("inputKind")]
    public string? InputKind { get; init; }

    /// <summary>Allocation lifecycle kind for <see cref="SessionNotificationKind.AllocationLifecycle"/>.</summary>
    [Key("allocationKind")]
    public string? AllocationKind { get; init; }

    [Key("displayWidth")]
    public int? DisplayWidth { get; init; }

    [Key("displayHeight")]
    public int? DisplayHeight { get; init; }

    [Key("logicalWidth")]
    public int? LogicalWidth { get; init; }

    [Key("logicalHeight")]
    public int? LogicalHeight { get; init; }

    [Key("inputBackend")]
    public string? InputBackend { get; init; }

    [Key("reason")]
    public string? Reason { get; init; }

    /// <summary>Dom Projection input / diff generation (to-generation for lifecycle bumps).</summary>
    [Key("domGeneration")]
    public long? DomGeneration { get; init; }

    /// <summary>Previous Dom Projection generation (lifecycle GenerationBumped).</summary>
    [Key("domFromGeneration")]
    public long? DomFromGeneration { get; init; }

    /// <summary>Dom Projection input anchor (when present).</summary>
    [Key("domAnchor")]
    public string? DomAnchor { get; init; }

    /// <summary>PageProjectionFrame plane (dom | cssom).</summary>
    [Key("pageProjectionFramePlane")]
    public string? PageProjectionFramePlane { get; init; }

    /// <summary>PageProjectionFrame operation.</summary>
    [Key("pageProjectionFrameOperation")]
    public string? PageProjectionFrameOperation { get; init; }

    [Key("pageProjectionFrameSequence")]
    public long? PageProjectionFrameSequence { get; init; }

    /// <summary>Sidecar/API PageProjectionFrame timestamp (ms) for FrameReceived facts.</summary>
    [Key("pageProjectionFrameTimestamp")]
    public long? PageProjectionFrameTimestamp { get; init; }

    /// <summary>Cssom install sheet count (FrameReceived enrichment).</summary>
    [Key("pageProjectionFrameSheetCount")]
    public int? PageProjectionFrameSheetCount { get; init; }

    [Key("pageProjectionFrameRuleCount")]
    public int? PageProjectionFrameRuleCount { get; init; }

    [Key("pageProjectionFrameSeededSheetCount")]
    public int? PageProjectionFrameSeededSheetCount { get; init; }

    /// <summary>
    /// QueueDropped stage (api_sequenced | api_fanout_no_target | api_fanout_pipe_closed |
    /// api_fanout_backpressure | api_wire_stall | sidecar_bridge | sidecar_requeue_overflow |
    /// sidecar_grpc_inflight | sidecar_lifecycle_overflow | sidecar_bridge_closed | mapper_rejected).
    /// </summary>
    [Key("pageProjectionFrameQueueStage")]
    public string? PageProjectionFrameQueueStage { get; init; }

    [Key("pageProjectionFrameDroppedCount")]
    public int? PageProjectionFrameDroppedCount { get; init; }

    [Key("pageProjectionFrameQueueCapacity")]
    public int? PageProjectionFrameQueueCapacity { get; init; }

    [Key("pageProjectionFrameLowestDroppedSequence")]
    public long? PageProjectionFrameLowestDroppedSequence { get; init; }

    [Key("pageProjectionFrameHighestDroppedSequence")]
    public long? PageProjectionFrameHighestDroppedSequence { get; init; }

    /// <summary>Client wire correlation id (when present on input).</summary>
    [Key("traceId")]
    public string? TraceId { get; init; }

    /// <summary>Client timestamp ms from wire (Video clientTimestampMs / Dom timestampClient).</summary>
    [Key("clientTimestampMs")]
    public long? ClientTimestampMs { get; init; }

    /// <summary>JSON payload for PageEpoch parity lifecycle kinds (<c>parity_*</c>).</summary>
    [Key("payloadJson")]
    public string? PayloadJson { get; init; }
}
