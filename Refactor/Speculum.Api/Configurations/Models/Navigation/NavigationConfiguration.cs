using Speculum.Api.Configurations.Models.Patterns;

namespace Speculum.Api.Configurations.Models.Navigation;

public sealed class NavigationConfiguration
{
    public string DefaultTargetHost { get; init; } = "";
    public IReadOnlyList<UrlMatchRule> AllowedMainFrameUrls { get; init; } = Array.Empty<UrlMatchRule>();
}
