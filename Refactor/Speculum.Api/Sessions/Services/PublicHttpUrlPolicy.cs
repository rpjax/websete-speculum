using System.Net;
using System.Net.Sockets;
using Aidan.Core.Patterns;

namespace Speculum.Api.Sessions.Services;

/// <summary>
/// Shared public-HTTP URL policy for remote script sources (config apply + any fetch path).
/// Rejects loopback, RFC1918, link-local, CGNAT, IPv4-mapped privates, and hostnames
/// that resolve to any non-public address.
/// </summary>
public static class PublicHttpUrlPolicy
{
    public static async Task<IResult> ValidateAsync(Uri remoteUrl, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(remoteUrl);

        if (!remoteUrl.IsAbsoluteUri || remoteUrl.Scheme is not ("http" or "https"))
            return Result.Failure("Remote script url must be absolute http/https");

        if (!string.IsNullOrEmpty(remoteUrl.UserInfo))
            return Result.Failure("Remote script url must not include user info");

        var host = remoteUrl.DnsSafeHost;
        if (string.IsNullOrWhiteSpace(host)
            || host.Equals("localhost", StringComparison.OrdinalIgnoreCase)
            || host.EndsWith(".localhost", StringComparison.OrdinalIgnoreCase)
            || host.EndsWith(".local", StringComparison.OrdinalIgnoreCase))
        {
            return Result.Failure("Remote script url host is not allowed");
        }

        if (IPAddress.TryParse(host, out var literal))
        {
            return IsPublicIp(literal)
                ? Result.Success()
                : Result.Failure("Remote script url host is not allowed");
        }

        IPAddress[] addresses;
        try
        {
            addresses = await Dns.GetHostAddressesAsync(host, ct).ConfigureAwait(false);
        }
        catch (Exception)
        {
            return Result.Failure("Remote script url host could not be resolved");
        }

        if (addresses.Length == 0 || addresses.Any(address => !IsPublicIp(address)))
            return Result.Failure("Remote script url host is not allowed");

        return Result.Success();
    }

    public static bool IsPublicIp(IPAddress address)
    {
        if (IPAddress.IsLoopback(address))
            return false;

        if (address.IsIPv6LinkLocal || address.IsIPv6SiteLocal || address.IsIPv6Multicast)
            return false;

        if (address.AddressFamily == AddressFamily.InterNetworkV6)
        {
            if (address.IsIPv4MappedToIPv6)
                return IsPublicIp(address.MapToIPv4());

            var bytes = address.GetAddressBytes();
            // fc00::/7 unique local
            if ((bytes[0] & 0xfe) == 0xfc)
                return false;

            return true;
        }

        if (address.AddressFamily != AddressFamily.InterNetwork)
            return false;

        var v4 = address.GetAddressBytes();
        // 0.0.0.0/8, 10/8, 127/8, 169.254/16, 172.16/12, 192.168/16, 100.64/10
        if (v4[0] == 0
            || v4[0] == 10
            || v4[0] == 127
            || (v4[0] == 169 && v4[1] == 254)
            || (v4[0] == 172 && v4[1] is >= 16 and <= 31)
            || (v4[0] == 192 && v4[1] == 168)
            || (v4[0] == 100 && v4[1] is >= 64 and <= 127))
        {
            return false;
        }

        return true;
    }
}
