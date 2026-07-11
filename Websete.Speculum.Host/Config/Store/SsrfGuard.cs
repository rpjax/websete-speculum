using System.Net;
using System.Net.Sockets;

namespace Websete.Speculum.Host.Config.Store;

public static class SsrfGuard
{
    public static bool IsAllowedUrl(Uri uri)
    {
        if (uri.Scheme is not "http" and not "https")
            return false;

        if (!IPAddress.TryParse(uri.Host, out var ip))
            return IsAllowedHostname(uri.Host);

        return IsAllowedIp(ip);
    }

    public static async Task ValidateResolvedHostAsync(
        string host,
        IDnsResolver dns,
        CancellationToken ct = default)
    {
        _ = await ResolveAndValidateHostAsync(host, dns, ct);
    }

    public static async Task<IPAddress[]> ResolveAndValidateHostAsync(
        string host,
        IDnsResolver dns,
        CancellationToken ct = default)
    {
        if (IPAddress.TryParse(host, out var literal))
        {
            if (!IsAllowedIp(literal))
                throw new InvalidOperationException($"Script URL blocked by SSRF guard: IP '{literal}' is not allowed.");
            return [literal];
        }

        if (!IsAllowedHostname(host))
            throw new InvalidOperationException($"Script URL blocked by SSRF guard: hostname '{host}' is not allowed.");

        var addresses = await dns.ResolveAsync(host, ct);
        if (addresses.Length == 0)
            throw new InvalidOperationException($"Script URL blocked by SSRF guard: hostname '{host}' did not resolve.");

        foreach (var address in addresses)
        {
            if (!IsAllowedIp(address))
                throw new InvalidOperationException(
                    $"Script URL blocked by SSRF guard: hostname '{host}' resolves to blocked address '{address}'.");
        }

        return addresses;
    }

    internal static bool IsAllowedHostname(string host)
    {
        if (host.Equals("localhost", StringComparison.OrdinalIgnoreCase))
            return false;

        if (host.EndsWith(".local", StringComparison.OrdinalIgnoreCase))
            return false;

        return true;
    }

    internal static IPAddress NormalizeIp(IPAddress ip)
    {
        if (ip.AddressFamily == AddressFamily.InterNetworkV6 && ip.IsIPv4MappedToIPv6)
            return ip.MapToIPv4();
        return ip;
    }

    internal static bool IsAllowedIp(IPAddress ip)
    {
        ip = NormalizeIp(ip);

        if (IPAddress.IsLoopback(ip)) return false;

        if (ip.AddressFamily == AddressFamily.InterNetwork)
        {
            var bytes = ip.GetAddressBytes();
            if (bytes[0] == 10) return false;
            if (bytes[0] == 127) return false;
            if (bytes[0] == 169 && bytes[1] == 254) return false;
            if (bytes[0] == 172 && bytes[1] >= 16 && bytes[1] <= 31) return false;
            if (bytes[0] == 192 && bytes[1] == 168) return false;
            if (bytes[0] == 100 && bytes[1] >= 64 && bytes[1] <= 127) return false;
            return true;
        }

        if (ip.AddressFamily == AddressFamily.InterNetworkV6)
        {
            var bytes = ip.GetAddressBytes();
            if ((bytes[0] & 0xFE) == 0xFC) return false; // ULA fc00::/7
            if (ip.IsIPv6LinkLocal || ip.IsIPv6SiteLocal) return false;
            if (ip.Equals(IPAddress.IPv6Loopback)) return false;
            return true;
        }

        return false;
    }
}
