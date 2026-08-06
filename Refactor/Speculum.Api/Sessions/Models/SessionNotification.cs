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
    /// <summary>DomProjectionInput rejected.</summary>
    DomProjectionInputRejected = 9,
    /// <summary>DomProjectionInput pushed to sidecar successfully (opt-in journal).</summary>
    DomProjectionInputApplied = 10,
    /// <summary>
    /// DomProjectionInput path hop
    /// (phase = data_plane_received | grpc_pushed | sidecar_admitted | cdp_dropped).
    /// </summary>
    DomProjectionInputPathTrace = 11,
    /// <summary>DomDiff frame received from WatchDom (opt-in journal).</summary>
    DomProjectionDiffFrame = 12,
    /// <summary>Dom Projection lifecycle (generation_bumped) from WatchDomProjectionLifecycle.</summary>
    DomProjectionLifecycle = 13,
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

    /// <summary>DomDiff kind (diff | cssom).</summary>
    [Key("domDiffKind")]
    public string? DomDiffKind { get; init; }

    /// <summary>DomDiff target (document | anchors) when kind is diff.</summary>
    [Key("domDiffTarget")]
    public string? DomDiffTarget { get; init; }

    [Key("domDiffTreeType")]
    public string? DomDiffTreeType { get; init; }

    [Key("domDiffSequence")]
    public long? DomDiffSequence { get; init; }

    [Key("domDiffNodeCount")]
    public int? DomDiffNodeCount { get; init; }

    [Key("domDiffUrlCount")]
    public int? DomDiffUrlCount { get; init; }

    /// <summary>Sidecar/API DomDiff timestamp (ms) for FrameReceived facts.</summary>
    [Key("domDiffTimestamp")]
    public long? DomDiffTimestamp { get; init; }

    /// <summary>Client wire correlation id (when present on input).</summary>
    [Key("traceId")]
    public string? TraceId { get; init; }

    /// <summary>Client timestamp ms from wire (Video clientTimestampMs / Dom timestampClient).</summary>
    [Key("clientTimestampMs")]
    public long? ClientTimestampMs { get; init; }
}
