namespace Speculum.Api.Configurations.Models.Patterns;

public sealed class DomainLabelPattern
{
    public PatternPartMatch Match { get; init; }
    public string Value { get; init; } = "";
}
