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
    /// <summary>PageProjectionDiff frame received from WatchPageProjectionDiff (opt-in journal).</summary>
    PageProjectionDiffFrame = 12,
    /// <summary>PageProjection lifecycle (generation_bumped | queue_dropped) from WatchPageProjectionLifecycle.</summary>
    PageProjectionLifecycle = 13,
    /// <summary>API sequenced Diff channel DropAll (opt-in journal).</summary>
    PageProjectionDiffQueueDropped = 14,
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

    /// <summary>PageProjectionDiff plane (dom | cssom).</summary>
    [Key("pageProjectionDiffPlane")]
    public string? PageProjectionDiffPlane { get; init; }

    /// <summary>PageProjectionDiff operation.</summary>
    [Key("pageProjectionDiffOperation")]
    public string? PageProjectionDiffOperation { get; init; }

    [Key("pageProjectionDiffSequence")]
    public long? PageProjectionDiffSequence { get; init; }

    /// <summary>Sidecar/API PageProjectionDiff timestamp (ms) for FrameReceived facts.</summary>
    [Key("pageProjectionDiffTimestamp")]
    public long? PageProjectionDiffTimestamp { get; init; }

    /// <summary>Cssom install sheet count (FrameReceived enrichment).</summary>
    [Key("pageProjectionDiffSheetCount")]
    public int? PageProjectionDiffSheetCount { get; init; }

    [Key("pageProjectionDiffRuleCount")]
    public int? PageProjectionDiffRuleCount { get; init; }

    [Key("pageProjectionDiffSeededSheetCount")]
    public int? PageProjectionDiffSeededSheetCount { get; init; }

    /// <summary>
    /// QueueDropped stage (api_sequenced | api_fanout_no_target | api_fanout_pipe_closed |
    /// sidecar_bridge | sidecar_requeue_overflow | sidecar_grpc_inflight |
    /// sidecar_lifecycle_overflow | sidecar_bridge_closed | mapper_rejected).
    /// </summary>
    [Key("pageProjectionDiffQueueStage")]
    public string? PageProjectionDiffQueueStage { get; init; }

    [Key("pageProjectionDiffDroppedCount")]
    public int? PageProjectionDiffDroppedCount { get; init; }

    [Key("pageProjectionDiffQueueCapacity")]
    public int? PageProjectionDiffQueueCapacity { get; init; }

    [Key("pageProjectionDiffLowestDroppedSequence")]
    public long? PageProjectionDiffLowestDroppedSequence { get; init; }

    [Key("pageProjectionDiffHighestDroppedSequence")]
    public long? PageProjectionDiffHighestDroppedSequence { get; init; }

    /// <summary>Client wire correlation id (when present on input).</summary>
    [Key("traceId")]
    public string? TraceId { get; init; }

    /// <summary>Client timestamp ms from wire (Video clientTimestampMs / Dom timestampClient).</summary>
    [Key("clientTimestampMs")]
    public long? ClientTimestampMs { get; init; }
}
