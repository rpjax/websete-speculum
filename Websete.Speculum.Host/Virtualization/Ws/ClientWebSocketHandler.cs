using System.Net.WebSockets;
using Websete.Speculum.Host.Virtualization.Services;

namespace Websete.Speculum.Host.Virtualization.Ws;

/// <summary>
/// Handles a binary WebSocket connection from one browser client at /ws/{sessionId}.
///
/// Two concurrent loops run for the lifetime of the connection:
///
///   Loop A — Frame relay (sidecar → client):
///     Reads binary frame messages from IVirtualizationSession.FrameChannel
///     (produced by SidecarClient.ReceiveLoopAsync) and forwards them byte-for-byte
///     to the browser client's WebSocket. The client decodes the tile/full/skip
///     protocol directly in JavaScript — no intermediate parsing in .NET.
///
///   Loop B — Input relay (client → sidecar):
///     Reads JSON text messages from the browser client WebSocket
///     (mousemove, keydown, navigate, etc.) and forwards them to
///     IVirtualizationSession.DispatchInputAsync, which sends them to the sidecar.
///
/// Both loops share a CancellationTokenSource. Either loop completing/faulting
/// cancels the other, then the WebSocket is closed cleanly.
/// </summary>
public static class ClientWebSocketHandler
{
    public static async Task HandleAsync(HttpContext context)
    {
        if (!context.WebSockets.IsWebSocketRequest)
        {
            context.Response.StatusCode = StatusCodes.Status400BadRequest;
            return;
        }

        var sessionId = context.Request.RouteValues["sessionId"]?.ToString();
        if (string.IsNullOrEmpty(sessionId))
        {
            context.Response.StatusCode = StatusCodes.Status400BadRequest;
            return;
        }

        var service = context.RequestServices.GetRequiredService<IVirtualizationService>();
        var session = service.GetSession(sessionId);

        if (session is null)
        {
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            await context.Response.WriteAsync($"Session '{sessionId}' not found.");
            return;
        }

        var ws     = await context.WebSockets.AcceptWebSocketAsync();
        var logger = context.RequestServices.GetRequiredService<ILoggerFactory>()
                        .CreateLogger(nameof(ClientWebSocketHandler));

        logger.LogInformation("[{Id}] Client WebSocket connected", sessionId);

        using var cts = new CancellationTokenSource();

        var frameTask = RelayFramesAsync(ws, session, sessionId, logger, cts.Token);
        var inputTask = RelayInputAsync(ws, session, sessionId, logger, cts.Token);

        // Wait for either loop to finish, then cancel the other.
        await Task.WhenAny(frameTask, inputTask);
        await cts.CancelAsync();

        // Await both to surface any unexpected exceptions.
        try { await Task.WhenAll(frameTask, inputTask); }
        catch (OperationCanceledException) { /* normal */ }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "[{Id}] WebSocket relay error", sessionId);
        }

        // Close the WebSocket gracefully if still open.
        if (ws.State == WebSocketState.Open)
        {
            try
            {
                await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "session ended",
                    CancellationToken.None);
            }
            catch { /* already closed */ }
        }

        logger.LogInformation("[{Id}] Client WebSocket disconnected", sessionId);
    }

    // ── Loop A: sidecar frames → client ──────────────────────────────────────

    private static async Task RelayFramesAsync(
        WebSocket              ws,
        IVirtualizationSession session,
        string                 sessionId,
        ILogger                logger,
        CancellationToken      ct)
    {
        try
        {
            await foreach (var frame in session.FrameChannel.ReadAllAsync(ct))
            {
                if (ws.State != WebSocketState.Open) break;

                await ws.SendAsync(frame, WebSocketMessageType.Binary, true, ct);
            }
        }
        catch (OperationCanceledException) { /* normal shutdown */ }
        catch (Exception ex) when (ex is not OutOfMemoryException)
        {
            logger.LogWarning(ex, "[{Id}] Frame relay error", sessionId);
        }
    }

    // ── Loop B: client input → sidecar ───────────────────────────────────────

    private static async Task RelayInputAsync(
        WebSocket              ws,
        IVirtualizationSession session,
        string                 sessionId,
        ILogger                logger,
        CancellationToken      ct)
    {
        // 8 KB is ample for a JSON input message; grow on demand.
        // Hard cap at 1 MB — no legitimate input message should approach this.
        // A client sending a message larger than the cap will have its connection
        // closed via the natural break path (ws.State check on next iteration).
        var buf          = new byte[8 * 1024];
        int filled       = 0;
        const int MaxMsg = 1 * 1024 * 1024; // 1 MB

        try
        {
            while (!ct.IsCancellationRequested && ws.State == WebSocketState.Open)
            {
                if (filled == buf.Length)
                {
                    if (buf.Length >= MaxMsg)
                    {
                        logger.LogWarning(
                            "[{Id}] Incoming message exceeds {Cap} MB; closing connection.",
                            sessionId, MaxMsg / 1024 / 1024);
                        break;
                    }
                    Array.Resize(ref buf, Math.Min(buf.Length * 2, MaxMsg));
                }

                var result = await ws.ReceiveAsync(buf.AsMemory(filled), ct);

                if (result.MessageType == WebSocketMessageType.Close) break;

                filled += result.Count;

                if (!result.EndOfMessage) continue;

                if (result.MessageType == WebSocketMessageType.Text)
                {
                    // Zero-copy relay: pass the raw UTF-8 bytes directly to the
                    // sidecar without decoding to string and re-encoding.
                    // Safe because RelayInputAsync is sequential — buf is not
                    // written again until after DispatchInputAsync returns.
                    await session.DispatchInputAsync(new ReadOnlyMemory<byte>(buf, 0, filled), ct);
                }
                // Binary messages from the client are not expected — ignore them.

                filled = 0;
            }
        }
        catch (OperationCanceledException) { /* normal shutdown */ }
        catch (Exception ex) when (ex is not OutOfMemoryException)
        {
            logger.LogWarning(ex, "[{Id}] Input relay error", sessionId);
        }
    }
}
