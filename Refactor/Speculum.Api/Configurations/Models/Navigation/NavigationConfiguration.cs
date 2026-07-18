namespace Speculum.Api.Configurations.Models.Navigation;

// configures the engines navigation
public sealed class NavigationConfiguration
{
    public string DefaultTargetHost { get; init; } = "";
    public IReadOnlyList<NavigationDomainRule> AllowedMainFrameDomains { get; init; } = Array.Empty<NavigationDomainRule>();
}
