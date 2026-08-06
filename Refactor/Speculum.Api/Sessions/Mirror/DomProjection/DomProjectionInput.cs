using MessagePack;

namespace Speculum.Api.Sessions.Mirror.DomProjection;

/// <summary>
/// Element-targeted / motion Dom Projection intent (data-plane MessagePack).
/// </summary>
[MessagePackObject]
public sealed class DomProjectionInput
{
    [Key("generation")]
    public long Generation { get; init; }

    /// <summary>mousemove | mousedown | mouseup | input | setFiles | keydown | … (no wire click)</summary>
    [Key("type")]
    public required string Type { get; init; }

    /// <summary><c>speculum-anchor</c>; null/empty for pure motion.</summary>
    [Key("anchor")]
    public string? Anchor { get; init; }

    [Key("timestampClient")]
    public double? TimestampClient { get; init; }

    /// <summary>Opaque client correlation id (always stamped on product send).</summary>
    [Key("traceId")]
    public string? TraceId { get; init; }

    /// <summary>DomProjectionIntentPayload JSON.</summary>
    [Key("payload")]
    public string Payload { get; init; } = "{}";
}
