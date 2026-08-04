using MessagePack;

namespace Speculum.Api.Sessions.Mirror.DomProjection;

/// <summary>
/// Dom Projection outbound unit (snapshot or incremental patch) for the data plane.
/// </summary>
[MessagePackObject]
public sealed class DomDiff
{
    [Key("sequence")]
    public long Sequence { get; init; }

    [Key("generation")]
    public long Generation { get; init; }

    [Key("timestamp")]
    public long Timestamp { get; init; }

    /// <summary>snapshot | patch</summary>
    [Key("kind")]
    public required string Kind { get; init; }

    [Key("root")]
    public DomNode? Root { get; init; }

    [Key("ops")]
    public List<DomOp>? Ops { get; init; }

    [Key("assetHints")]
    public List<DomAssetHint>? AssetHints { get; init; }
}
