using System.Net;
using System.Net.Sockets;

namespace Websete.Speculum.Host.Config.Store;

public interface IDnsResolver
{
    Task<IPAddress[]> ResolveAsync(string host, CancellationToken ct = default);
}

public sealed class SystemDnsResolver : IDnsResolver
{
    public async Task<IPAddress[]> ResolveAsync(string host, CancellationToken ct = default)
        => (await Dns.GetHostAddressesAsync(host, ct)).Where(a => a.AddressFamily is AddressFamily.InterNetwork or AddressFamily.InterNetworkV6).ToArray();
}
