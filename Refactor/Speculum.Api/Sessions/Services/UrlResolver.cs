using System.Text;
using System.Text.Json;
using Aidan.Core.Patterns;
using Speculum.Api.Configurations.Models.Hosting;
using Speculum.Api.Configurations.Models.Patterns;
using Speculum.Api.Configurations.Services.Contracts;
using Speculum.Api.Sessions.Services.Contracts;

namespace Speculum.Api.Sessions.Services;

public sealed class UrlResolver : IUrlResolver
{
    private const string NavigationStateParameter = "_w7s_nso";
    private readonly IConfigurationService _configuration;

    public UrlResolver(IConfigurationService configuration)
    {
        _configuration = configuration;
    }

    public IResult<string> Resolve(string path, string query, string requestHost)
    {
        if (!TryNormalizeRequestHost(requestHost, out var clientHost))
        {
            return Result<string>.Failure("Request host is invalid");
        }

        if (string.IsNullOrEmpty(path) || path[0] != '/' || path.Contains('?'))
        {
            return Result<string>.Failure("Navigation path must be absolute and contain no query");
        }

        var configuration = _configuration.GetCurrent();
        var defaultTargetHost = configuration.Navigation.DefaultTargetHost.Trim().ToLowerInvariant();
        if (!IsValidHost(defaultTargetHost))
        {
            return Result<string>.Failure("Navigation.DefaultTargetHost is invalid");
        }

        var navigationState = TryExtractNavigationState(query);
        if (navigationState.IsFailure)
        {
            return Result<string>.Failure(navigationState.Errors.ToArray());
        }

        var targetHost = ResolveTargetHost(
            clientHost,
            defaultTargetHost,
            configuration.Hosting.Domains,
            configuration.Navigation.AllowedMainFrameUrls,
            navigationState.Value);
        if (targetHost.IsFailure)
        {
            return Result<string>.Failure(targetHost.Errors.ToArray());
        }

        var targetQuery = StripNavigationState(query);
        var uri = new UriBuilder(Uri.UriSchemeHttps, targetHost.Value)
        {
            Path = path,
            Query = targetQuery,
        }.Uri.AbsoluteUri;

        return Result<string>.Success(uri);
    }

    private static IResult<string> ResolveTargetHost(
        string requestHost,
        string defaultTargetHost,
        IReadOnlyList<DomainConfiguration> hostingDomains,
        IReadOnlyList<UrlMatchRule> allowedUrls,
        NavigationState? navigationState)
    {
        foreach (var profile in hostingDomains)
        {
            var sessionDomain = profile.Domain.Trim().ToLowerInvariant();
            if (!IsValidHost(sessionDomain))
            {
                continue;
            }

            var isApex = requestHost == sessionDomain;
            var isWww = requestHost == $"www.{sessionDomain}";
            var suffix = $".{sessionDomain}";
            var isSubdomain = requestHost.EndsWith(suffix, StringComparison.Ordinal)
                && requestHost.Length > suffix.Length;

            if (profile.IsSubdomainMirroringEnabled)
            {
                if (isApex)
                {
                    // Mirroring ignores NSO; the apex session host maps to the bootstrap host.
                    return Result<string>.Success(defaultTargetHost);
                }

                if (isWww || isSubdomain)
                {
                    var subdomain = isWww
                        ? "www"
                        : requestHost[..^suffix.Length];
                    return ResolveMirroredTarget(subdomain, defaultTargetHost, allowedUrls);
                }

                continue;
            }

            if (isApex || isWww)
            {
                return ResolveApexTarget(defaultTargetHost, allowedUrls, navigationState);
            }
        }

        return ResolveApexTarget(defaultTargetHost, allowedUrls, navigationState);
    }

    private static IResult<string> ResolveMirroredTarget(
        string subdomain,
        string defaultTargetHost,
        IReadOnlyList<UrlMatchRule> allowedUrls)
    {
        if (!TryGetTargetApex(defaultTargetHost, allowedUrls, out var apex))
        {
            return Result<string>.Failure(
                "Navigation.AllowedMainFrameUrls must define the target apex for subdomain mirroring");
        }

        var candidate = $"{subdomain}.{apex}";
        return IsAllowedTargetHost(candidate, defaultTargetHost, allowedUrls)
            ? Result<string>.Success(candidate)
            : Result<string>.Failure("Mirrored target host is not allowed");
    }

    private static IResult<string> ResolveApexTarget(
        string defaultTargetHost,
        IReadOnlyList<UrlMatchRule> allowedUrls,
        NavigationState? navigationState)
    {
        var stateHost = navigationState?.Host.Trim().ToLowerInvariant();
        if (string.IsNullOrEmpty(stateHost))
        {
            return Result<string>.Success(defaultTargetHost);
        }

        string candidate;
        if (stateHost.Contains('.'))
        {
            candidate = stateHost;
        }
        else
        {
            if (!TryGetTargetApex(defaultTargetHost, allowedUrls, out var apex))
            {
                return Result<string>.Failure(
                    "Navigation.AllowedMainFrameUrls must define the target apex for navigation state");
            }

            candidate = $"{stateHost}.{apex}";
        }

        return IsValidHost(candidate)
            && IsAllowedTargetHost(candidate, defaultTargetHost, allowedUrls)
                ? Result<string>.Success(candidate)
                : Result<string>.Failure("Navigation state target host is invalid or not allowed");
    }

    private static string StripNavigationState(string query)
    {
        if (string.IsNullOrWhiteSpace(query))
        {
            return "";
        }

        return string.Join(
            '&',
            query.TrimStart('?')
                .Split('&', StringSplitOptions.RemoveEmptyEntries)
                .Where(part => !part.StartsWith(
                    NavigationStateParameter + "=",
                    StringComparison.Ordinal)));
    }

    private static IResult<NavigationState?> TryExtractNavigationState(string query)
    {
        foreach (var part in query.TrimStart('?')
                     .Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            if (!part.StartsWith(
                    NavigationStateParameter + "=",
                    StringComparison.Ordinal))
            {
                continue;
            }

            var encoded = part[(NavigationStateParameter.Length + 1)..];
            if (string.IsNullOrWhiteSpace(encoded))
            {
                return Result<NavigationState?>.Failure("Navigation state is empty");
            }

            try
            {
                var json = Encoding.UTF8.GetString(
                    Convert.FromBase64String(Uri.UnescapeDataString(encoded)));
                using var document = JsonDocument.Parse(json);
                var root = document.RootElement;
                if (!root.TryGetProperty("v", out var version)
                    || !version.TryGetInt32(out var value)
                    || value != 1
                    || !root.TryGetProperty("h", out var host)
                    || host.ValueKind != JsonValueKind.String)
                {
                    return Result<NavigationState?>.Failure("Navigation state is invalid");
                }

                return Result<NavigationState?>.Success(
                    new NavigationState(host.GetString() ?? ""));
            }
            catch (FormatException)
            {
                return Result<NavigationState?>.Failure("Navigation state is invalid");
            }
            catch (JsonException)
            {
                return Result<NavigationState?>.Failure("Navigation state is invalid");
            }
        }

        return Result<NavigationState?>.Success(null);
    }

    private static bool TryGetTargetApex(
        string defaultTargetHost,
        IReadOnlyList<UrlMatchRule> allowedUrls,
        out string apex)
    {
        var candidates = new List<string>();
        foreach (var rule in allowedUrls)
        {
            if (!TryGetConfiguredApex(rule.Domain, out var candidate))
            {
                continue;
            }

            if (defaultTargetHost == candidate
                || defaultTargetHost.EndsWith(
                    $".{candidate}",
                    StringComparison.Ordinal))
            {
                candidates.Add(candidate);
            }
        }

        apex = candidates
            .OrderBy(candidate => candidate.Count(character => character == '.'))
            .ThenBy(candidate => candidate.Length)
            .FirstOrDefault() ?? "";
        return apex.Length > 0;
    }

    private static bool TryGetConfiguredApex(DomainPattern domain, out string host)
    {
        host = "";
        if (domain.Scope != PatternScope.Pattern
            || domain.Labels.Count == 0)
        {
            return false;
        }

        var labels = domain.Labels;
        var start = labels[0].Match == PatternPartMatch.Any ? 1 : 0;
        if (start == labels.Count
            || labels.Skip(start).Any(label =>
                label.Match != PatternPartMatch.Exact
                || string.IsNullOrWhiteSpace(label.Value)))
        {
            return false;
        }

        host = string.Join(
            '.',
            labels.Skip(start)
                .Select(label => label.Value.Trim().ToLowerInvariant()));
        return IsValidHost(host);
    }

    private static bool IsAllowedTargetHost(
        string host,
        string defaultTargetHost,
        IReadOnlyList<UrlMatchRule> allowedUrls)
    {
        if (host.Equals(defaultTargetHost, StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        return allowedUrls.Any(rule => Matches(rule.Domain, host));
    }

    private static bool Matches(DomainPattern domain, string host)
    {
        // Scope.Any is not an allow-all for URL resolve; only explicit patterns match.
        if (domain.Scope != PatternScope.Pattern || domain.Labels.Count == 0)
        {
            return false;
        }

        if (domain.Labels[0].Match == PatternPartMatch.Any)
        {
            if (!TryGetConfiguredApex(domain, out var apex))
            {
                return false;
            }

            // Same semantics as DomainMatcher / sidecar: *.apex matches subdomains only.
            return host.EndsWith($".{apex}", StringComparison.OrdinalIgnoreCase)
                && !host.Equals(apex, StringComparison.OrdinalIgnoreCase);
        }

        if (domain.Labels.Any(label =>
                label.Match != PatternPartMatch.Exact
                || string.IsNullOrWhiteSpace(label.Value)))
        {
            return false;
        }

        var exact = string.Join(
            '.',
            domain.Labels.Select(label => label.Value.Trim().ToLowerInvariant()));
        return host.Equals(exact, StringComparison.OrdinalIgnoreCase);
    }

    private static bool TryNormalizeRequestHost(string requestHost, out string host)
    {
        host = "";
        if (string.IsNullOrWhiteSpace(requestHost)
            || !Uri.TryCreate($"https://{requestHost.Trim()}", UriKind.Absolute, out var uri)
            || string.IsNullOrWhiteSpace(uri.Host)
            || uri.AbsolutePath != "/"
            || !string.IsNullOrEmpty(uri.Query)
            || !string.IsNullOrEmpty(uri.Fragment)
            || !string.IsNullOrEmpty(uri.UserInfo))
        {
            return false;
        }

        host = uri.Host.ToLowerInvariant();
        return true;
    }

    private static bool IsValidHost(string host)
        => Uri.TryCreate($"https://{host}", UriKind.Absolute, out var uri)
            && string.Equals(uri.Host, host, StringComparison.OrdinalIgnoreCase);

    private sealed record NavigationState(string Host);
}
