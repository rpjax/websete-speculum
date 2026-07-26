using MessagePack;

namespace Speculum.Api.Sessions.Models;

/// <summary>Kind of informative session notification from the sidecar.</summary>
public enum SessionNotificationKind
{
    LocationChanged = 1,
    MainFrameNavigationBlocked = 2,
    EditableFocusChanged = 3,
    Crashed = 4,
    InputRejected = 5,
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
}
