using System.Net;
using System.Net.Sockets;
using System.Text;
using Aidan.Core.Patterns;
using Speculum.Api.Scripts.Services;
using Speculum.Api.Sessions.Services.Contracts;

namespace Speculum.Api.Sessions.Services;

public sealed class RemoteScriptFetcher : IRemoteScriptFetcher
{
    public const string HttpClientName = nameof(RemoteScriptFetcher);

    private readonly IHttpClientFactory _httpClientFactory;

    public RemoteScriptFetcher(IHttpClientFactory httpClientFactory)
    {
        _httpClientFactory = httpClientFactory ?? throw new ArgumentNullException(nameof(httpClientFactory));
    }

    public async Task<IResult<string>> FetchAsync(Uri remoteUrl, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(remoteUrl);

        var hostCheck = await ValidatePublicHttpUrlAsync(remoteUrl, ct).ConfigureAwait(false);
        if (hostCheck.IsFailure)
        {
            return hostCheck;
        }

        using var client = _httpClientFactory.CreateClient(HttpClientName);
        using var response = await client.GetAsync(
            remoteUrl,
            HttpCompletionOption.ResponseHeadersRead,
            ct).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
        {
            return Result<string>.Failure(
                $"Remote script fetch failed with status {(int)response.StatusCode}");
        }

        if (response.Content.Headers.ContentLength is { } declared
            && declared > ScriptService.MaxScriptBytes)
        {
            return Result<string>.Failure(
                $"Remote script exceeds {ScriptService.MaxScriptBytes} bytes");
        }

        await using var stream = await response.Content.ReadAsStreamAsync(ct).ConfigureAwait(false);
        using var limited = new MemoryStream(capacity: Math.Min(ScriptService.MaxScriptBytes, 64 * 1024));
        var buffer = new byte[16 * 1024];
        var total = 0;
        while (true)
        {
            var read = await stream.ReadAsync(buffer.AsMemory(0, buffer.Length), ct).ConfigureAwait(false);
            if (read == 0)
            {
                break;
            }

            total += read;
            if (total > ScriptService.MaxScriptBytes)
            {
                return Result<string>.Failure(
                    $"Remote script exceeds {ScriptService.MaxScriptBytes} bytes");
            }

            await limited.WriteAsync(buffer.AsMemory(0, read), ct).ConfigureAwait(false);
        }

        return Result<string>.Success(Encoding.UTF8.GetString(limited.ToArray()));
    }

    internal static async Task<IResult<string>> ValidatePublicHttpUrlAsync(
        Uri remoteUrl,
        CancellationToken ct = default)
    {
        if (!remoteUrl.IsAbsoluteUri || remoteUrl.Scheme is not ("http" or "https"))
        {
            return Result<string>.Failure("Remote script url must be absolute http/https");
        }

        if (!string.IsNullOrEmpty(remoteUrl.UserInfo))
        {
            return Result<string>.Failure("Remote script url must not include user info");
        }

        var host = remoteUrl.DnsSafeHost;
        if (string.IsNullOrWhiteSpace(host)
            || host.Equals("localhost", StringComparison.OrdinalIgnoreCase)
            || host.EndsWith(".localhost", StringComparison.OrdinalIgnoreCase)
            || host.EndsWith(".local", StringComparison.OrdinalIgnoreCase))
        {
            return Result<string>.Failure("Remote script url host is not allowed");
        }

        if (IPAddress.TryParse(host, out var literal))
        {
            return IsPublicIp(literal)
                ? Result<string>.Success(string.Empty)
                : Result<string>.Failure("Remote script url host is not allowed");
        }

        IPAddress[] addresses;
        try
        {
            addresses = await Dns.GetHostAddressesAsync(host, ct).ConfigureAwait(false);
        }
        catch (Exception)
        {
            return Result<string>.Failure("Remote script url host could not be resolved");
        }

        if (addresses.Length == 0 || addresses.Any(address => !IsPublicIp(address)))
        {
            return Result<string>.Failure("Remote script url host is not allowed");
        }

        return Result<string>.Success(string.Empty);
    }

    internal static bool IsPublicIp(IPAddress address)
    {
        if (IPAddress.IsLoopback(address))
        {
            return false;
        }

        if (address.IsIPv6LinkLocal || address.IsIPv6SiteLocal || address.IsIPv6Multicast)
        {
            return false;
        }

        if (address.AddressFamily == AddressFamily.InterNetworkV6)
        {
            if (address.IsIPv4MappedToIPv6)
            {
                return IsPublicIp(address.MapToIPv4());
            }

            var bytes = address.GetAddressBytes();
            // fc00::/7 unique local, fe80::/10 link-local already covered.
            if ((bytes[0] & 0xfe) == 0xfc)
            {
                return false;
            }

            return true;
        }

        if (address.AddressFamily != AddressFamily.InterNetwork)
        {
            return false;
        }

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
