using MessagePack;

namespace Speculum.Api.BrowserSessions.Models;

/// <summary>JPEG frame from CDP Page.startScreencast (type tag stripped).</summary>
[MessagePackObject]
public sealed class Frame
{
    /// <summary>Raw JPEG bytes (no MSG_SCREENCAST prefix).</summary>
    [Key("jpeg")]
    public byte[] Jpeg { get; init; } = [];

    /// <summary>Monotonic sequence for stale-frame discard on the client.</summary>
    [Key("sequence")]
    public long Sequence { get; init; }

    /// <summary>Capture timestamp in Unix ms (UTC).</summary>
    [Key("timestamp")]
    public long Timestamp { get; init; }
}
