using MessagePack;

namespace Speculum.Api.Sessions.Mirror.PageProjection;

/// <summary>
/// Element-targeted / motion Dom Projection intent (data-plane MessagePack).
/// </summary>
[MessagePackObject]
public sealed class PageProjectionIntent
{
    [Key("generation")]
    public long Generation { get; init; }

    /// <summary>mousemove | mousedown | mouseup | input | setFiles | keydown | … (no wire click)</summary>
    [Key("type")]
    public required string Type { get; init; }

    /// <summary><c>speculum-anchor</c>; null/empty for pure motion. Deprecated — kept for the V1 transition (§5.11 amends input §6.7).</summary>
    [Key("anchor")]
    public string? Anchor { get; init; }

    /// <summary>
    /// Redesigned id-addressed target (§5.11): resolved through the sidecar's reverse id
    /// map; null for pure motion or while the client still addresses by <see cref="Anchor"/>.
    /// </summary>
    [Key("targetId")]
    public uint? TargetId { get; init; }

    /// <summary>V4 multi-document browsing context (root = 1).</summary>
    [Key("contextId")]
    public uint ContextId { get; init; } = 1;

    [Key("timestampClient")]
    public double? TimestampClient { get; init; }

    /// <summary>Opaque client correlation id (always stamped on product send).</summary>
    [Key("traceId")]
    public string? TraceId { get; init; }

    /// <summary>PageProjectionIntentPayload JSON.</summary>
    [Key("payload")]
    public string Payload { get; init; } = "{}";

    /// <summary>Unified input schema version (§10.6). 0 = legacy V2 envelope.</summary>
    [Key("schemaVersion")]
    public int SchemaVersion { get; init; }

    [Key("viewportW")]
    public int? ViewportW { get; init; }

    [Key("viewportH")]
    public int? ViewportH { get; init; }

    /// <summary>Scroll census JSON (PP down/up only).</summary>
    [Key("census")]
    public string? Census { get; init; }
}
