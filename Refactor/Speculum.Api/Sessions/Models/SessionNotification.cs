namespace Speculum.Api.Sessions.Models;

/// <summary>Kind of informative session notification from the sidecar.</summary>
public enum SessionNotificationKind
{
    LocationChanged = 1,
    MainFrameNavigationBlocked = 2,
    EditableFocusChanged = 3,
    Crashed = 4,
}

/// <summary>
/// Fire-and-forget observation from the live browser (not request/response).
/// Consumed via <c>ISessionConnection.GetNotificationReader</c>.
/// </summary>
public sealed class SessionNotification
{
    public required SessionNotificationKind Kind { get; init; }

    /// <summary>URL for location / navigation-blocked kinds.</summary>
    public string? Url { get; init; }

    /// <summary>Editable focus; null means blur for <see cref="SessionNotificationKind.EditableFocusChanged"/>.</summary>
    public EditingState? Editing { get; init; }

    public string? ErrorCode { get; init; }

    public string? Message { get; init; }

    public string? Phase { get; init; }
}
