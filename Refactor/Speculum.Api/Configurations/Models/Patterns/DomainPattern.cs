namespace Speculum.Api.Configurations.Models.Patterns;

public sealed class DomainPattern
{
    public PatternScope Scope { get; init; }
    public IReadOnlyList<DomainLabelPattern> Labels { get; init; } = [];
}
