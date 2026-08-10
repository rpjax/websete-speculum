using MessagePack;

namespace Speculum.Api.Sessions.Mirror.PageProjection;

/// <summary>Projected DOM node identified by <c>speculum-anchor</c>.</summary>
[MessagePackObject]
public sealed class DomNode
{
    [Key("anchor")]
    public string Anchor { get; init; } = "";

    [Key("tag")]
    public string Tag { get; init; } = "";

    [Key("attrs")]
    public Dictionary<string, string>? Attrs { get; init; }

    [Key("text")]
    public string? Text { get; init; }

    [Key("children")]
    public List<DomNode>? Children { get; init; }
}
