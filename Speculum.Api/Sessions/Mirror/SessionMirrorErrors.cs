namespace Speculum.Api.Sessions.Mirror;

/// <summary>
/// Shared mirror-mode failure codes and messages for HTTP edges and live session gates.
/// </summary>
public static class SessionMirrorErrors
{
    public const string MirrorModeMismatchErrorCode = "mirror_mode_mismatch";

    public const string PageProjectionRequiredMessage =
        "MirrorMode.PageProjection is required";

    public const string VideoStreamingRequiredMessage =
        "MirrorMode.VideoStreaming is required";
}
