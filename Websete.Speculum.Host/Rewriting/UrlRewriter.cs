using System.Collections.Immutable;
using System.Text.RegularExpressions;
using Websete.Speculum.Host.Config;

namespace Websete.Speculum.Host.Rewriting;

/// <summary>
/// Singleton implementation of <see cref="IUrlRewriter"/>.
///
/// At construction time each forwarding rule's <c>Downstream</c> field is
/// compiled into a <see cref="Regex"/> with a 250 ms timeout so pathological
/// inputs cannot block the thread. The subdomain suffix string for each
/// profile is also pre-computed to avoid per-request allocations. All
/// per-request work is read-only and thread-safe.
///
/// Rewriting semantics:
///   • The profile is selected by matching the request host against
///     <c>ForwardingProfile.Domain</c> (exact) or any subdomain of it
///     (when <c>AllowSubDomains</c> is <c>true</c>).
///   • Rules from the matched profile are applied in declaration order,
///     each doing a regex-replace of its <c>Downstream</c> pattern with
///     its <c>Upstream</c> replacement inside the full URL string.
///   • Path, query string, and fragment are preserved automatically because
///     the pattern only ever matches the domain portion of the URL.
///
/// Example (config from appsettings):
///   Profile.Domain = "websete.localhost"
///   Rule.Downstream = "websete.localhost"  →  Rule.Upstream = "olx.com.br"
///
///   Input : "https://www.websete.localhost/cars?q=1"
///   Output: "https://www.olx.com.br/cars?q=1"
/// </summary>
public sealed class UrlRewriter : IUrlRewriter
{
    // One compiled profile per ForwardingProfile entry.
    private readonly ImmutableArray<CompiledProfile> _profiles;
    private readonly ILogger<UrlRewriter>            _logger;

    private readonly record struct CompiledRule(Regex Pattern, string Replacement);

    private readonly record struct CompiledProfile(
        string  Domain,
        string  SubdomainSuffix,  // pre-computed "." + Domain
        bool    AllowSubDomains,
        ImmutableArray<CompiledRule> Rules);

    public UrlRewriter(SpeculumConfig config, ILogger<UrlRewriter> logger)
    {
        ArgumentNullException.ThrowIfNull(config);
        _logger = logger;

        var profiles = ImmutableArray.CreateBuilder<CompiledProfile>(
            config.ForwardingProfiles.Length);

        foreach (var profile in config.ForwardingProfiles)
        {
            var rules = ImmutableArray.CreateBuilder<CompiledRule>(profile.Rules.Length);

            foreach (var rule in profile.Rules)
            {
                // Escape the downstream domain so dots and other regex
                // meta-characters are treated as literals.
                var pattern = new Regex(
                    Regex.Escape(rule.Downstream),
                    RegexOptions.IgnoreCase | RegexOptions.Compiled,
                    matchTimeout: TimeSpan.FromMilliseconds(250));

                rules.Add(new CompiledRule(pattern, rule.Upstream));
            }

            profiles.Add(new CompiledProfile(
                profile.Domain,
                '.' + profile.Domain,      // pre-computed subdomain suffix
                profile.AllowSubDomains,
                rules.MoveToImmutable()));
        }

        _profiles = profiles.MoveToImmutable();
    }

    /// <inheritdoc/>
    public string? Rewrite(string url, string requestHost)
    {
        if (string.IsNullOrEmpty(url))         return null;
        if (string.IsNullOrEmpty(requestHost)) return null;

        // Strip port from the host (Uri.Host already does this but callers
        // may pass the raw Host header which includes the port).
        var host = StripPort(requestHost);

        var profile = FindProfile(host);
        if (profile is null) return null;

        var result = url;

        foreach (var rule in profile.Value.Rules)
        {
            try
            {
                result = rule.Pattern.Replace(result, rule.Replacement);
            }
            catch (RegexMatchTimeoutException)
            {
                // A pathological URL triggered the 250 ms safety timeout.
                // Log so the issue is visible in production, then skip this rule.
                _logger.LogWarning(
                    "[UrlRewriter] Regex match timed out for rule " +
                    "(pattern: {Pattern}, url length: {Len}). Rule skipped.",
                    rule.Pattern, url.Length);
            }
        }

        return result;
    }

    // ── Internals ─────────────────────────────────────────────────────────────

    private CompiledProfile? FindProfile(string host)
    {
        foreach (var profile in _profiles)
        {
            // Exact match always works regardless of AllowSubDomains.
            if (host.Equals(profile.Domain, StringComparison.OrdinalIgnoreCase))
                return profile;

            // Subdomain match: host ends with ".<domain>" (pre-computed suffix).
            if (profile.AllowSubDomains &&
                host.EndsWith(profile.SubdomainSuffix, StringComparison.OrdinalIgnoreCase))
                return profile;
        }

        return null;
    }

    private static string StripPort(string host)
    {
        // IPv6 bracketed address: "[::1]:443" — the last colon is after ']'.
        if (host.StartsWith('['))
        {
            var bracket = host.IndexOf(']');
            return bracket >= 0 ? host[..(bracket + 1)] : host;
        }

        // Ordinary host: "example.com:443".
        var colon = host.LastIndexOf(':');
        return colon > 0 ? host[..colon] : host;
    }
}
