using MessagePack;

namespace Speculum.Api.Sessions.Mirror.DomProjection;

/// <summary>Incremental Dom Projection operation.</summary>
[MessagePackObject]
public sealed class DomOp
{
    /// <summary>insert | remove | setAttr | removeAttr | setText | move</summary>
    [Key("op")]
    public required string Op { get; init; }

    [Key("id")]
    public int Id { get; init; }

    [Key("parentId")]
    public int? ParentId { get; init; }

    [Key("index")]
    public int? Index { get; init; }

    [Key("tag")]
    public string? Tag { get; init; }

    [Key("name")]
    public string? Name { get; init; }

    [Key("value")]
    public string? Value { get; init; }

    [Key("text")]
    public string? Text { get; init; }

    [Key("node")]
    public DomNode? Node { get; init; }
}
