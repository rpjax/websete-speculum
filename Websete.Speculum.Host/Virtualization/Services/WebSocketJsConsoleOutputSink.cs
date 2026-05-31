using System.Net.WebSockets;

namespace Websete.Speculum.Host.Virtualization.Services;

/// <summary>
/// Implementação de <see cref="IJsConsoleOutputSink"/> que retransmite saídas
/// do console JS ao cliente via WebSocket binário.
/// </summary>
/// <remarks>
/// O payload já está no formato de protocolo binário
/// (<c>MSG_CONSOLE</c> 0x05 ou <c>MSG_EVAL_RESULT</c> 0x06) produzido pelo
/// sidecar — relay direto sem re-serialização.
/// </remarks>
public sealed class WebSocketJsConsoleOutputSink : IJsConsoleOutputSink
{
    private readonly WebSocket     _socket;
    private readonly SemaphoreSlim _sendLock;

    /// <param name="socket">WebSocket do cliente.</param>
    /// <param name="sendLock">
    /// Semáforo compartilhado com outros sinks que escrevem no mesmo WebSocket.
    /// </param>
    public WebSocketJsConsoleOutputSink(WebSocket socket, SemaphoreSlim sendLock)
    {
        _socket   = socket;
        _sendLock = sendLock;
    }

    public async Task WriteConsoleOutputAsync(ConsoleOutputEvent outputEvent, CancellationToken ct = default)
    {
        await _sendLock.WaitAsync(ct);
        try
        {
            await _socket.SendAsync(
                outputEvent.Data,
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
