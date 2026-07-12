namespace Speculum.Api.Config.Runtime;

public static class InitialUrlBuilder
{
    /// <summary>
    /// Builds the virtual browser's initial URL from forwarding config and the client's current URL.
    /// </summary>
    public static string Build(
        ForwardingOptions forwarding,
        string clientUrl,
        bool subdomainMirroringEnabled,
        string motorPublicDomain)
    {
        ArgumentNullException.ThrowIfNull(forwarding);

        if (string.IsNullOrWhiteSpace(forwarding.Host))
            throw new ArgumentException("Forwarding host is required.", nameof(forwarding));

        if (!Uri.TryCreate(clientUrl, UriKind.Absolute, out var uri))
            throw new ArgumentException("clientUrl must be an absolute URL.", nameof(clientUrl));

        if (subdomainMirroringEnabled)
            return HostMapper.MapClientToTarget(clientUrl, motorPublicDomain, forwarding);

        return $"https://{forwarding.Host.Trim()}{uri.PathAndQuery}";
    }
}
