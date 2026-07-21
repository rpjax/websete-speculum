namespace Speculum.Api.Configurations.Models.Patterns;

public sealed class PathPattern
{
    public PatternScope Scope { get; init; }
    public PathMatchType MatchType { get; init; }
    public IReadOnlyList<PathSegmentPattern> Segments { get; init; } = [];
}
