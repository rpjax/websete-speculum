namespace Speculum.Api.Motor.Live.Models;

/// <summary>JPEG frame from CDP Page.startScreencast (type tag stripped).</summary>
public sealed class Frame
{
    /// <summary>Raw JPEG bytes (no MSG_SCREENCAST prefix).</summary>
    public byte[] Jpeg { get; init; } = [];

    /// <summary>Monotonic sequence for stale-frame discard on the client.</summary>
    public long Sequence { get; init; }

    /// <summary>Capture timestamp in Unix ms (UTC).</summary>
    public long Timestamp { get; init; }
}
