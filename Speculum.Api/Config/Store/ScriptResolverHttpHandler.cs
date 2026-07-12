using System.Net;
using System.Net.Sockets;

namespace Speculum.Api.Config.Store;

public static class ScriptResolverHttpHandler
{
    public static SocketsHttpHandler Create(IDnsResolver dns)
    {
        var handler = new SocketsHttpHandler
        {
            AllowAutoRedirect = false,
            ConnectCallback   = (context, cancellationToken) =>
                ConnectAsync(context, dns, cancellationToken),
        };
        return handler;
    }

    private static async ValueTask<Stream> ConnectAsync(
        SocketsHttpConnectionContext context,
        IDnsResolver dns,
        CancellationToken cancellationToken)
    {
        var host = context.DnsEndPoint.Host;
        var port = context.DnsEndPoint.Port;

        var addresses = await SsrfGuard.ResolveAndValidateHostAsync(host, dns, cancellationToken);
        var address   = addresses[0];

        var socket = new Socket(address.AddressFamily, SocketType.Stream, ProtocolType.Tcp);
        try
        {
            await socket.ConnectAsync(new IPEndPoint(address, port), cancellationToken);
            return new NetworkStream(socket, ownsSocket: true);
        }
        catch
        {
            socket.Dispose();
            throw;
        }
    }
}
