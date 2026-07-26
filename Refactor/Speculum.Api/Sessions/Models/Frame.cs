using MessagePack;

namespace Speculum.Api.Sessions.Models;

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

    /// <summary>
    /// Relay receipt timestamp in Unix ms (UTC), sampled by the API because the
    /// sidecar/CDP frame message does not carry a capture clock.
    /// </summary>
    [Key("timestamp")]
    public long Timestamp { get; init; }
}
