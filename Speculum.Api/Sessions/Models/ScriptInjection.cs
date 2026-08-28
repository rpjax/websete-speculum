using Speculum.Api.Configurations.Models.Patterns;

namespace Speculum.Api.Sessions.Models;

/// <summary>
/// Launch script snapshot for the sidecar. Stored scripts carry inline <see cref="Content"/>;
/// remote scripts carry <see cref="RemoteUrl"/> (sidecar fetches and inlines into the CDP bundle).
/// </summary>
public sealed class ScriptInjection
{
    public required string Type { get; init; }

    /// <summary>Virtual file id for diagnostics / stored path label.</summary>
    public required string File { get; init; }

    /// <summary>Inline JS for stored scripts; empty for remote until sidecar resolve.</summary>
    public string Content { get; init; } = "";

    /// <summary>Absolute http(s) URL for remote scripts; null for stored.</summary>
    public string? RemoteUrl { get; init; }

    public IReadOnlyList<UrlMatchRule> TargetRules { get; init; } = Array.Empty<UrlMatchRule>();
}
