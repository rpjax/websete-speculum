using Speculum.Api.Config.Runtime;
using Speculum.Api.Config.Store;

namespace Speculum.Api.Motor.Mapping;

public static class HostMapper
{
    public static string MapClientToTarget(
        string clientUrl,
        string motorPublicDomain,
        ForwardingOptions forwarding)
    {
        if (!Uri.TryCreate(clientUrl, UriKind.Absolute, out var clientUri))
            throw new ArgumentException("clientUrl must be an absolute URL.", nameof(clientUrl));

        var targetHost = MapClientHostToTarget(clientUri.Host, motorPublicDomain, forwarding);
        return $"https://{targetHost}{clientUri.PathAndQuery}";
    }

    public static string MapTargetToClient(
        string targetUrl,
        string motorPublicDomain,
        ForwardingOptions forwarding)
    {
        if (!Uri.TryCreate(targetUrl, UriKind.Absolute, out var targetUri))
            return targetUrl;

        if (targetUri.Scheme is not "http" and not "https")
            return targetUrl;

        if (!DomainMatcher.MatchesAny(targetUri.Host, forwarding.Domains))
            return targetUrl;

        var clientHost = MapTargetHostToClient(targetUri.Host, motorPublicDomain, forwarding);
        return $"{targetUri.Scheme}://{clientHost}{targetUri.PathAndQuery}";
    }

    public static string MapTargetToApexClient(
        string targetUrl,
        string motorPublicDomain)
    {
        if (!Uri.TryCreate(targetUrl, UriKind.Absolute, out var targetUri))
            return targetUrl;

        if (targetUri.Scheme is not "http" and not "https")
            return targetUrl;

        return $"{targetUri.Scheme}://{motorPublicDomain.Trim()}{targetUri.PathAndQuery}";
    }

    public static bool IsAllowedMotorOrigin(string origin, string motorPublicDomain)
    {
        if (!Uri.TryCreate(origin, UriKind.Absolute, out var uri))
            return false;

        var host = uri.Host;
        var motor = motorPublicDomain.Trim();

        if (host.Equals(motor, StringComparison.OrdinalIgnoreCase))
            return true;

        return host.EndsWith('.' + motor, StringComparison.OrdinalIgnoreCase);
    }

    private static string MapClientHostToTarget(
        string clientHost,
        string motorPublicDomain,
        ForwardingOptions forwarding)
    {
        var motor = motorPublicDomain.Trim();
        var targetApex = GetTargetApex(forwarding);

        if (clientHost.Equals(motor, StringComparison.OrdinalIgnoreCase))
            return forwarding.Host.Trim();

        var motorSuffix = '.' + motor;
        if (clientHost.EndsWith(motorSuffix, StringComparison.OrdinalIgnoreCase))
        {
            var sub = clientHost[..^motorSuffix.Length];
            if (string.IsNullOrEmpty(sub))
                return forwarding.Host.Trim();

            var candidate = $"{sub}.{targetApex}";
            if (DomainMatcher.MatchesAny(candidate, forwarding.Domains))
                return candidate;
        }

        return forwarding.Host.Trim();
    }

    private static string MapTargetHostToClient(
        string targetHost,
        string motorPublicDomain,
        ForwardingOptions forwarding)
    {
        var motor      = motorPublicDomain.Trim();
        var targetApex = GetTargetApex(forwarding);

        if (targetHost.Equals(targetApex, StringComparison.OrdinalIgnoreCase))
            return motor;

        var apexSuffix = '.' + targetApex;
        if (targetHost.EndsWith(apexSuffix, StringComparison.OrdinalIgnoreCase))
        {
            var sub = targetHost[..^apexSuffix.Length];
            if (!string.IsNullOrEmpty(sub))
                return $"{sub}.{motor}";
        }

        if (targetHost.Equals(forwarding.Host.Trim(), StringComparison.OrdinalIgnoreCase))
        {
            if (forwarding.Host.EndsWith(apexSuffix, StringComparison.OrdinalIgnoreCase))
            {
                var sub = forwarding.Host[..^apexSuffix.Length];
                if (!string.IsNullOrEmpty(sub))
                    return $"{sub}.{motor}";
            }
        }

        return motor;
    }

    private static string GetTargetApex(ForwardingOptions forwarding)
    {
        foreach (var pattern in forwarding.Domains)
        {
            if (!pattern.StartsWith("*.", StringComparison.Ordinal))
                return pattern.Trim();
        }

        var host = forwarding.Host.Trim();
        var dot = host.IndexOf('.');
        return dot >= 0 ? host[(dot + 1)..] : host;
    }

    public static bool HasWildcardDomain(IEnumerable<string> domains)
        => domains.Any(d => d.TrimStart().StartsWith("*.", StringComparison.Ordinal));
}
