namespace Speculum.Api.Configurations.Models.Navigation;

public sealed class NavigationDomainRule
{
    public IReadOnlyList<DomainLabelPattern> Labels { get; init; } = Array.Empty<DomainLabelPattern>();
}
