using MessagePack;

namespace Speculum.Api.Sessions.Mirror.DomProjection;

/// <summary>
/// Element-targeted input for MirrorMode.DomProjection (data-plane MessagePack).
/// </summary>
[MessagePackObject]
public sealed class DomProjectionInput
{
    /// <summary>click | input | keydown | keyup | scroll</summary>
    [Key("type")]
    public required string Type { get; init; }

    [Key("targetId")]
    public int TargetId { get; init; }

    /// <summary>Type-specific JSON fields (value, key, deltaY, …).</summary>
    [Key("payload")]
    public string Payload { get; init; } = "{}";
}
