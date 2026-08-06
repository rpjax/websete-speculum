using MessagePack;

namespace Speculum.Api.Sessions.Mirror.DomProjection;

/// <summary>
/// Dom Projection outbound unit (<c>diff</c> with <see cref="Target"/>, or <c>cssom</c> reload list).
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

    /// <summary>dom | cssom</summary>
    [Key("treeType")]
    public required string TreeType { get; init; }

    /// <summary>diff | cssom</summary>
    [Key("kind")]
    public required string Kind { get; init; }

    /// <summary>document | anchors — required when <see cref="Kind"/> is diff.</summary>
    [Key("target")]
    public string? Target { get; init; }

    /// <summary>Dom diff: mapped nodes (document root or anchor subtrees).</summary>
    [Key("nodes")]
    public List<DomNode>? Nodes { get; init; }

    /// <summary>CSSOM: virtual-asset URLs to reload.</summary>
    [Key("urls")]
    public List<string>? Urls { get; init; }
}
