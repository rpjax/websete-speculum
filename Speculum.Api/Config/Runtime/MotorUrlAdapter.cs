namespace Speculum.Api.Config.Runtime;

public sealed class MotorUrlAdapter
{
    private readonly NavigationStateCodec _codec;

    public MotorUrlAdapter(NavigationStateCodec codec)
    {
        _codec = codec;
    }

    public string ParseClientToTarget(
        string clientUrl,
        HostingProfileOptions profile,
        ForwardingOptions forwarding)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(clientUrl);

        if (!Uri.TryCreate(clientUrl, UriKind.Absolute, out var uri))
            throw new ArgumentException("clientUrl must be an absolute URL.", nameof(clientUrl));

        if (profile.SubdomainMirroringEnabled)
            return HostMapper.MapClientToTarget(clientUrl, profile.Domain, forwarding);

        return ParseApexClientToTarget(uri, forwarding);
    }

    public string ParseClientToTargetBootstrap(string clientUrl, ForwardingOptions forwarding)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(clientUrl);

        if (!Uri.TryCreate(clientUrl, UriKind.Absolute, out var uri))
            throw new ArgumentException("clientUrl must be an absolute URL.", nameof(clientUrl));

        return ParseApexClientToTarget(uri, forwarding);
    }

    public string EncodeTargetToClient(
        string targetUrl,
        HostingProfileOptions profile,
        ForwardingOptions forwarding,
        string motorRequestHost)
    {
        if (!Uri.TryCreate(targetUrl, UriKind.Absolute, out var targetUri))
            return targetUrl;

        if (profile.SubdomainMirroringEnabled)
            return HostMapper.MapTargetToClient(targetUrl, profile.Domain, forwarding);

        var motorHost = ResolveMotorHostForRequest(motorRequestHost, profile);
        var state = BuildStateFromTargetHost(targetUri.Host, forwarding);
        var nso = _codec.Encode(state);
        var path = targetUri.AbsolutePath;
        var siteQuery = StripNsoFromQueryString(targetUri.Query);
        var clientQuery = string.IsNullOrEmpty(siteQuery)
            ? $"?{NavigationStateParam.Name}={nso}"
            : $"{siteQuery}&{NavigationStateParam.Name}={nso}";

        return $"{targetUri.Scheme}://{motorHost}{path}{clientQuery}";
    }

    public string EncodeTargetToClientBootstrap(
        string targetUrl,
        ForwardingOptions forwarding,
        string motorRequestHost)
    {
        if (!Uri.TryCreate(targetUrl, UriKind.Absolute, out var targetUri))
            return targetUrl;

        var host = motorRequestHost.Split(':')[0].Trim();
        if (string.IsNullOrEmpty(host))
            host = forwarding.Host.Trim();

        return $"{targetUri.Scheme}://{host}{targetUri.PathAndQuery}";
    }

    public static string ResolveMotorHostForRequest(string requestHost, HostingProfileOptions profile)
    {
        var host = requestHost.Split(':')[0].Trim();
        if (host.Equals("www." + profile.Domain, StringComparison.OrdinalIgnoreCase))
            return host;
        return profile.Domain.Trim();
    }

    private string ParseApexClientToTarget(Uri uri, ForwardingOptions forwarding)
    {
        var (path, query) = StripNsoFromClientQuery(uri);
        var state = ExtractNso(uri);
        var targetHost = ResolveTargetHost(state, forwarding);
        var targetQuery = BuildTargetQuery(query);
        return $"https://{targetHost}{path}{targetQuery}";
    }

    private static (string Path, string Query) StripNsoFromClientQuery(Uri uri)
    {
        if (string.IsNullOrEmpty(uri.Query))
            return (uri.AbsolutePath, "");

        var parts = uri.Query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries);
        var kept = parts.Where(p => !p.StartsWith(NavigationStateParam.Name + "=", StringComparison.Ordinal))
                        .ToArray();
        return (uri.AbsolutePath, kept.Length == 0 ? "" : "?" + string.Join("&", kept));
    }

    private static string StripNsoFromQueryString(string query)
    {
        if (string.IsNullOrEmpty(query))
            return "";

        var parts = query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries);
        var kept = parts.Where(p => !p.StartsWith(NavigationStateParam.Name + "=", StringComparison.Ordinal))
                        .ToArray();
        return kept.Length == 0 ? "" : "?" + string.Join("&", kept);
    }

    private static string BuildTargetQuery(string clientQueryWithoutNso)
        => clientQueryWithoutNso;

    private NavigationStateV1? ExtractNso(Uri uri)
    {
        if (string.IsNullOrEmpty(uri.Query))
            return null;

        foreach (var part in uri.Query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            if (part.StartsWith(NavigationStateParam.Name + "=", StringComparison.Ordinal))
            {
                var value = part[(NavigationStateParam.Name.Length + 1)..];
                return _codec.Decode(value);
            }
        }

        return null;
    }

    private static string ResolveTargetHost(NavigationStateV1? state, ForwardingOptions forwarding)
    {
        var apex = GetTargetApex(forwarding);
        if (state is null || string.IsNullOrWhiteSpace(state.H))
            return forwarding.Host.Trim();

        var label = state.H.Trim();
        if (label.Contains('.'))
            return label;

        return $"{label}.{apex}";
    }

    private static NavigationStateV1 BuildStateFromTargetHost(string targetHost, ForwardingOptions forwarding)
    {
        var apex = GetTargetApex(forwarding);
        var host = targetHost.Trim().ToLowerInvariant();
        var forwardingHost = forwarding.Host.Trim().ToLowerInvariant();
        var apexLower = apex.ToLowerInvariant();

        if (host == forwardingHost || host == apexLower)
            return new NavigationStateV1 { H = "" };

        var suffix = "." + apexLower;
        if (host.EndsWith(suffix, StringComparison.Ordinal))
        {
            var sub = host[..^suffix.Length];
            return new NavigationStateV1 { H = sub };
        }

        return new NavigationStateV1 { H = "" };
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
}
