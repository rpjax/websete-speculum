namespace Speculum.Api.Config.Runtime;

public static class InitialUrlBuilder
{
    public static string Build(
        MotorUrlAdapter adapter,
        ForwardingOptions forwarding,
        string clientUrl,
        HostingProfileOptions? profile,
        string motorRequestHost)
    {
        ArgumentNullException.ThrowIfNull(forwarding);
        ArgumentNullException.ThrowIfNull(adapter);

        if (string.IsNullOrWhiteSpace(forwarding.Host))
            throw new ArgumentException("Forwarding host is required.", nameof(forwarding));

        if (profile is null)
            return adapter.ParseClientToTargetBootstrap(clientUrl, forwarding);

        return adapter.ParseClientToTarget(clientUrl, profile, forwarding);
    }

    public static string BuildNavigateTarget(
        MotorUrlAdapter adapter,
        ForwardingOptions forwarding,
        string clientUrl,
        HostingProfileOptions? profile,
        string motorRequestHost)
        => Build(adapter, forwarding, clientUrl, profile, motorRequestHost);
}
