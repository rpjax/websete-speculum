namespace Speculum.Api.Sessions.Services.Streaming;

/// <summary>
/// Kind of a single outbound stream registration (not the wire <c>SessionPipeKind</c> byte).
/// </summary>
internal enum OutputStreamKind
{
    Frame,
    PageProjectionFrames,
    Console,
    Notification,
}

internal static class OutputStreamKindNames
{
    public static string ToTelemetry(OutputStreamKind kind)
        => kind switch
        {
            OutputStreamKind.Frame => "frame",
            OutputStreamKind.PageProjectionFrames => "pageProjectionFrames",
            OutputStreamKind.Console => "console",
            OutputStreamKind.Notification => "notification",
            _ => "?",
        };
}
