using MessagePack;

namespace Speculum.Api.Sessions.Mirror.DomProjection;

/// <summary>Compact projected DOM node (main-frame V1).</summary>
[MessagePackObject]
public sealed class DomNode
{
    [Key("id")]
    public int Id { get; init; }

    [Key("tag")]
    public string Tag { get; init; } = "";

    [Key("attrs")]
    public Dictionary<string, string>? Attrs { get; init; }

    [Key("text")]
    public string? Text { get; init; }

    [Key("children")]
    public List<DomNode>? Children { get; init; }
}
