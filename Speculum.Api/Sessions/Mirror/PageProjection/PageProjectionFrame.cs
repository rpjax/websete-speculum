using MessagePack;

namespace Speculum.Api.Sessions.Mirror.PageProjection;

/// <summary>
/// PageProjection outbound envelope — opaque §5.5 binary body relayed without parsing (PP-WIRE-1).
/// </summary>
/// <remarks>
/// <see cref="Plane"/>/<see cref="Operation"/> are deprecated routing hints on the legacy V1 JSON
/// wire; on the redesign path they are empty. The API never parses <see cref="Body"/> (M4).
/// Proto hygiene for legacy field names: deferred to M6 (<c>motor-migration.md</c>).
/// </remarks>
[MessagePackObject]
public sealed class PageProjectionFrame
{
    [Key("sequence")]
    public long Sequence { get; init; }

    [Key("generation")]
    public long Generation { get; init; }

    [Key("timestamp")]
    public long Timestamp { get; init; }

    /// <summary>dom | cssom. Deprecated for binary frames — empty string (M6: not on gRPC wire).</summary>
    [Key("plane")]
    public required string Plane { get; init; }

    /// <summary>Deprecated routing hint — empty string on redesign wire.</summary>
    [Key("operation")]
    public required string Operation { get; init; }

    /// <summary>Opaque §5.5 binary frame/part body. Never parsed by the API.</summary>
    [Key("body")]
    public byte[]? Body { get; init; }

    /// <summary>Part index within the frame (§5.5.3); 0 when the frame was not split.</summary>
    [Key("partIndex")]
    public uint PartIndex { get; init; }

    /// <summary>Total part count for the frame (§5.5.3); 1 when the frame was not split.</summary>
    [Key("partCount")]
    public uint PartCount { get; init; } = 1;

    /// <summary>Bit 0 establish, bit 1 resync — see sidecar <c>mirror/page/encode.ts</c>.</summary>
    [Key("flags")]
    public uint Flags { get; init; }

    /// <summary>Wire format version (§5.5); an unknown version desyncs (PP-WIRE-2).</summary>
    [Key("version")]
    public uint Version { get; init; } = 1;

    [Key("contextId")]
    public uint ContextId { get; init; } = 1;
}
