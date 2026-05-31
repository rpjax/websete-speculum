using System.Net.WebSockets;

namespace Websete.Speculum.Host.Virtualization.Services;

/// <summary>
/// Implementação de <see cref="IDownstreamConnection"/> sobre um WebSocket do
/// ASP.NET Core.
/// </summary>
public sealed class WebSocketDownstreamConnection : IDownstreamConnection
{
    private readonly WebSocket _socket;

    public WebSocketDownstreamConnection(WebSocket socket) => _socket = socket;

    /// <summary>
    /// Envia o frame de fechamento ao cliente (half-close via
    /// <see cref="WebSocket.CloseOutputAsync"/>). Não aguarda o eco do peer —
    /// o sidecar inicia o próprio teardown ao receber o frame.
    /// </summary>
    public async Task CloseAsync(CancellationToken ct = default)
    {
        if (_socket.State is WebSocketState.Open or WebSocketState.CloseReceived)
        {
            try
            {
                await _socket.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, null, ct);
            }
            catch (WebSocketException) { /* socket já encerrado pelo peer */ }
        }
    }
}
