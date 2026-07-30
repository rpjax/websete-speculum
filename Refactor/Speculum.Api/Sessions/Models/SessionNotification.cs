using MessagePack;

namespace Speculum.Api.Sessions.Models;

/// <summary>Kind of informative session notification from the sidecar.</summary>
public enum SessionNotificationKind
{
    LocationChanged = 1,
    MainFrameNavigationBlocked = 2,
    EditableFocusChanged = 3,
    /// <summary>True Chromium/session fault from sidecar <c>onCrash</c> — not transport.</summary>
    Crashed = 4,
    InputRejected = 5,
    /// <summary>Input was pushed to the sidecar successfully (test/debug journal only).</summary>
    InputApplied = 6,
    /// <summary>Opt-in input-path hop (phase = wt_received | grpc_pushed | sidecar_admitted).</summary>
    InputPathTrace = 7,
    /// <summary>Opt-in allocation lifecycle from sidecar WatchAllocationLifecycle.</summary>
    AllocationLifecycle = 8,
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

    /// <summary>Wire input type for <see cref="SessionNotificationKind.InputApplied"/>.</summary>
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
}
