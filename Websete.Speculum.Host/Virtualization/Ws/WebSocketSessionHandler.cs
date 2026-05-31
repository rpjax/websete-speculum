using System.Net.WebSockets;
using Websete.Speculum.Host.Virtualization.Services;

namespace Websete.Speculum.Host.Virtualization.Ws;

/// <summary>
/// Handles a WebSocket session for one browser client.
///
/// Multiplexes three logical channels on a single binary WebSocket connection:
///
///   Video    (server → client): MSG_H264 frames  — byte[0] = 0x07
///   Control  (server → client): MSG_URL / MSG_CONSOLE / MSG_EVAL_RESULT — byte[0] = 0x04/05/06
///   Input    (client → server): JSON text events — all input/control commands
///
/// The client identifies each message by its leading type byte.
/// All client → server messages arrive as JSON text (UTF-8 bytes in a binary WebSocket frame
/// or as text frames — handler accepts both).
/// </summary>
public static class WebSocketSessionHandler
{
    public static async Task HandleAsync(
        HttpContext            context,
        IVirtualizationService service,
        ILogger                logger)
    {
        if (!context.WebSockets.IsWebSocketRequest)
        {
            context.Response.StatusCode = StatusCodes.Status426UpgradeRequired;
            return;
        }

        var sessionId = context.Request.RouteValues["sessionId"]?.ToString();
        if (string.IsNullOrEmpty(sessionId))
        {
            context.Response.StatusCode = StatusCodes.Status400BadRequest;
            return;
        }

        var session = service.GetSession(sessionId);
        if (session is null)
        {
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            return;
        }

        logger.LogInformation("[{Id}] WebSocket client connected", sessionId);

        // ── Keepalive — the SINGLE choke-point for session lifecycle ────────────
        // Server sends a WebSocket Ping every 15 s.
        // If the client (browser) does not echo a Pong within 10 s the socket is
        // closed by ASP.NET Core automatically, ReceiveAsync returns, the loop
        // exits, and the finally block below disposes the session.
        //
        // This handles ALL disconnect scenarios with zero extra code:
        //   • Clean tab close  → WS Close frame received immediately
        //   • Browser crash    → Ping timeout fires after ≤ 25 s
        //   • Network drop     → Ping timeout fires after ≤ 25 s
        //   • Idle viewer      → Pings keep the channel alive (no false positive)
        using var webSocket = await context.WebSockets.AcceptWebSocketAsync(
            new WebSocketAcceptContext
            {
                KeepAliveInterval = TimeSpan.FromSeconds(15),
                KeepAliveTimeout  = TimeSpan.FromSeconds(10),
            });
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(context.RequestAborted);
        var       ct        = cts.Token;

        // Prevents concurrent SendAsync calls on the same WebSocket instance.
        // (WebSocket does not support concurrent writes.)
        var sendLock = new SemaphoreSlim(1, 1);

        try
        {
            var videoTask   = RelayVideoAsync  (webSocket, session, sendLock, sessionId, logger, ct);
            var controlTask = RelayControlAsync(webSocket, session, sendLock, sessionId, logger, ct);
            var inputTask   = ReceiveInputAsync (webSocket, session, sessionId, logger, ct);

            // Any task ending (disconnect, channel closed, error) cancels the others.
            await Task.WhenAny(videoTask, controlTask, inputTask);
            await cts.CancelAsync();

            try { await Task.WhenAll(videoTask, controlTask, inputTask); }
            catch (OperationCanceledException) { /* normal shutdown */ }
            catch (Exception ex) { logger.LogWarning(ex, "[{Id}] WS relay error", sessionId); }
        }
        finally
        {
            sendLock.Dispose();

            // Best-effort graceful close — ignore if the socket is already gone.
            try
            {
                if (webSocket.State == WebSocketState.Open)
                    await webSocket.CloseOutputAsync(
                        WebSocketCloseStatus.NormalClosure, null, CancellationToken.None);
            }
            catch { /* best-effort */ }

            await service.CloseSessionAsync(sessionId);
            logger.LogInformation("[{Id}] WebSocket client disconnected", sessionId);
        }
    }

    // ── Video relay — server → client ────────────────────────────────────────

    private static async Task RelayVideoAsync(
        WebSocket              ws,
        IVirtualizationSession session,
        SemaphoreSlim          sendLock,
        string                 sessionId,
        ILogger                logger,
        CancellationToken      ct)
    {
        try
        {
            await foreach (var msg in session.VideoChannel.ReadAllAsync(ct))
            {
                // msg is the full MSG_H264 buffer:
                //   [0x07][isKeyframe:1][dataLen:4 LE][H.264 Annex B data]
                // Relay as-is — client identifies it by the 0x07 leading byte.
                await sendLock.WaitAsync(ct);
                try   { await ws.SendAsync(msg, WebSocketMessageType.Binary, true, ct); }
                finally { sendLock.Release(); }
            }
        }
        catch (OperationCanceledException) { /* normal */ }
        catch (Exception ex) when (ex is not OutOfMemoryException)
        {
            logger.LogWarning(ex, "[{Id}] Video relay error", sessionId);
        }
    }

    // ── Control relay — server → client ──────────────────────────────────────

    private static async Task RelayControlAsync(
        WebSocket              ws,
        IVirtualizationSession session,
        SemaphoreSlim          sendLock,
        string                 sessionId,
        ILogger                logger,
        CancellationToken      ct)
    {
        try
        {
            await foreach (var msg in session.ControlChannel.ReadAllAsync(ct))
            {
                // msg is a raw binary control message (MSG_URL, MSG_CONSOLE, MSG_EVAL_RESULT).
                // Leading type byte tells the client which message type it is.
                await sendLock.WaitAsync(ct);
                try   { await ws.SendAsync(msg, WebSocketMessageType.Binary, true, ct); }
                finally { sendLock.Release(); }
            }
        }
        catch (OperationCanceledException) { /* normal */ }
        catch (Exception ex) when (ex is not OutOfMemoryException)
        {
            logger.LogWarning(ex, "[{Id}] Control relay error", sessionId);
        }
    }

    // ── Input receive — client → server ──────────────────────────────────────

    private static async Task ReceiveInputAsync(
        WebSocket              ws,
        IVirtualizationSession session,
        string                 sessionId,
        ILogger                logger,
        CancellationToken      ct)
    {
        // 64 KB is generous for any JSON input event.
        var buf = new byte[64 * 1024];

        try
        {
            while (!ct.IsCancellationRequested && ws.State == WebSocketState.Open)
            {
                var result = await ws.ReceiveAsync(buf, ct);

                if (result.MessageType == WebSocketMessageType.Close) break;
                if (result.Count == 0) continue;

                // All client events are JSON (text or binary framing).
                // Pass the raw UTF-8 bytes directly to the sidecar — it parses JSON.
                await session.DispatchInputAsync(
                    new ReadOnlyMemory<byte>(buf, 0, result.Count), ct);
            }
        }
        catch (OperationCanceledException) { /* normal */ }
        catch (Exception ex) when (ex is not OutOfMemoryException)
        {
            logger.LogWarning(ex, "[{Id}] Input receive error", sessionId);
        }
    }
}
