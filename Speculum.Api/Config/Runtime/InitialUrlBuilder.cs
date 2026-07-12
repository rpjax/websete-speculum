namespace Speculum.Api.Config.Runtime;

public static class InitialUrlBuilder
{
    /// <summary>
    /// Builds the virtual browser's initial URL from the configured forwarding host
    /// and the client's current URL (pathname + query only).
    /// </summary>
    public static string Build(string forwardingHost, string clientUrl)
    {
        if (string.IsNullOrWhiteSpace(forwardingHost))
            throw new ArgumentException("Forwarding host is required.", nameof(forwardingHost));

        if (!Uri.TryCreate(clientUrl, UriKind.Absolute, out var uri))
            throw new ArgumentException("clientUrl must be an absolute URL.", nameof(clientUrl));

        return $"https://{forwardingHost.Trim()}{uri.PathAndQuery}";
    }
}
