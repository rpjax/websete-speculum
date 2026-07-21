namespace Speculum.Api.Configurations.Models.Patterns;

public sealed class PathSegmentPattern
{
    public PatternPartMatch Match { get; init; }
    public string Value { get; init; } = "";
}
