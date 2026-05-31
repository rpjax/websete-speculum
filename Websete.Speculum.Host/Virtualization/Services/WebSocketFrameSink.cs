using System.Net.WebSockets;

namespace Websete.Speculum.Host.Virtualization.Services;

/// <summary>
/// Implementação de <see cref="IFrameSink"/> que retransmite frames H.264
/// ao cliente via WebSocket binário.
/// </summary>
/// <remarks>
/// O frame chega no formato MSG_H264 completo:
/// <c>[0x07][isKeyframe:1][dataLen:4 LE][H.264 Annex B data]</c>.
/// O cliente identifica o tipo pelo byte inicial — relay direto sem
/// re-serialização.
/// </remarks>
public sealed class WebSocketFrameSink : IFrameSink
{
    private readonly WebSocket     _socket;
    private readonly SemaphoreSlim _sendLock;

    /// <param name="socket">WebSocket do cliente.</param>
    /// <param name="sendLock">
    /// Semáforo compartilhado com outros sinks que escrevem no mesmo WebSocket.
    /// WebSocket não suporta envios concorrentes — o lock serializa os writes.
    /// </param>
    public WebSocketFrameSink(WebSocket socket, SemaphoreSlim sendLock)
    {
        _socket   = socket;
        _sendLock = sendLock;
    }

    public async Task WriteFrameAsync(Frame frame, CancellationToken ct = default)
    {
        await _sendLock.WaitAsync(ct);
        try
        {
            await _socket.SendAsync(
                frame.Data,
                WebSocketMessageType.Binary,
                endOfMessage: true,
                cancellationToken: ct);
        }
        finally
        {
            _sendLock.Release();
        }
    }
}
