using Speculum.Api.Configurations.Models.Patterns;

namespace Speculum.Api.Configurations.Models.Navigation;

/// <summary>
/// Main-frame navigation targets for the session generation.
/// Allowlist applies to main-frame navigations only (assets / XHR / subframes are not gated here).
/// </summary>
public sealed class NavigationConfiguration
{
    public const string SectionName = "Navigation";

    public string DefaultTargetHost { get; init; } = "";

    /// <summary>
    /// Host (+ optional path) rules for allowlisted main-frame targets.
    /// Default <see cref="PathPattern.Scope"/> of <see cref="PatternScope.Any"/> means any path on a matching host.
    /// </summary>
    public IReadOnlyList<UrlMatchRule> AllowedMainFrameUrls { get; init; } = Array.Empty<UrlMatchRule>();
}
