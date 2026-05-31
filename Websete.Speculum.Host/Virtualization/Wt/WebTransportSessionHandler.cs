using System.Runtime.Versioning;
using System.Text.Json;
using Microsoft.AspNetCore.Connections;
using Microsoft.AspNetCore.Connections.Features;
using Microsoft.AspNetCore.Http.Features;
using Websete.Speculum.Host.Virtualization.Services;

namespace Websete.Speculum.Host.Virtualization.Wt;

/// <summary>
/// Handles a WebTransport session for one browser client.
///
/// Manages three dedicated QUIC streams:
///
///   Video stream   (server opens, unidirectional server→client):
///     H.264 Annex B frames, length-prefixed.
///     Format: [4 bytes LE uint32 data_len][1 byte is_keyframe][data_len bytes H.264]
///
///   Control stream (client opens, bidirectional):
///     Client→Server: [4 bytes LE uint32 len][len bytes UTF-8 JSON commands]
///     Server→Client: raw binary messages (MSG_URL, MSG_CONSOLE, MSG_EVAL_RESULT)
///
///   Input stream   (client opens, unidirectional client→server):
///     Mouse moves:  [0x01][2 bytes LE uint16 x][2 bytes LE uint16 y]
///     Other events: [0x02][4 bytes LE uint32 len][len bytes UTF-8 JSON]
/// </summary>
[RequiresPreviewFeatures]
public static class WebTransportSessionHandler
{
    [RequiresPreviewFeatures]
    public static async Task HandleAsync(
        HttpContext            context,
        IVirtualizationService service,
        ILogger                logger)
    {
        var feature = context.Features.Get<IHttpWebTransportFeature>();
        if (feature is null || !feature.IsWebTransportRequest)
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
            await context.Response.WriteAsync($"Session '{sessionId}' not found.");
            return;
        }

        logger.LogInformation("[{Id}] WebTransport client connected", sessionId);

        using var cts = CancellationTokenSource.CreateLinkedTokenSource(context.RequestAborted);
        var       ct  = cts.Token;

        IWebTransportSession? wtSession = null;
        try
        {
            wtSession = await feature.AcceptAsync(ct);

            // Open the video stream immediately — client waits for it.
            var videoCtx    = await wtSession.OpenUnidirectionalStreamAsync(ct);
            var videoStream = videoCtx!.Transport!.Output!.AsStream();

            // Run the video relay loop.
            var videoTask = RelayVideoAsync(videoStream, session, sessionId, logger, ct);

            // Accept client-opened streams (control + input).
            var acceptTask = AcceptClientStreamsAsync(wtSession, session, sessionId, logger, ct);

            await Task.WhenAny(videoTask, acceptTask);
            await cts.CancelAsync();

            try { await Task.WhenAll(videoTask, acceptTask); }
            catch (OperationCanceledException) { /* normal */ }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "[{Id}] WebTransport relay error", sessionId);
            }
        }
        catch (OperationCanceledException) { /* client disconnected */ }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "[{Id}] WebTransport setup error", sessionId);
        }
        finally
        {
            try { wtSession?.Abort(0); } catch { /* best-effort */ }
            await service.CloseSessionAsync(sessionId);
            logger.LogInformation("[{Id}] WebTransport client disconnected", sessionId);
        }
    }

    // ── Video stream: relay H.264 frames from sidecar to client ──────────────

    private static async Task RelayVideoAsync(
        Stream                 stream,
        IVirtualizationSession session,
        string                 sessionId,
        ILogger                logger,
        CancellationToken      ct)
    {
        // Header buffer: [4 bytes data_len][1 byte is_keyframe]
        var header = new byte[5];

        try
        {
            await foreach (var msg in session.VideoChannel.ReadAllAsync(ct))
            {
                // msg layout: [0] 0x07 | [1] isKeyframe | [2..5] data_len LE | [6..] H.264
                if (msg.Length < 6) continue;

                var span = msg.Span;
                var isKeyframe = span[1];
                var dataLen    = BitConverter.ToUInt32(span[2..6]);
                if (6 + dataLen > msg.Length) continue;

                // Write header: data_len (4 bytes LE) + is_keyframe (1 byte)
                BitConverter.TryWriteBytes(header.AsSpan(0, 4), dataLen);
                header[4] = isKeyframe;

                await stream.WriteAsync(header, ct);
                await stream.WriteAsync(msg[6..], ct);
                await stream.FlushAsync(ct);
            }
        }
        catch (OperationCanceledException) { /* normal shutdown */ }
        catch (Exception ex) when (ex is not OutOfMemoryException)
        {
            logger.LogWarning(ex, "[{Id}] Video relay error", sessionId);
        }
    }

    // ── Accept client streams ─────────────────────────────────────────────────

    [RequiresPreviewFeatures]
    private static async Task AcceptClientStreamsAsync(
        IWebTransportSession   wtSession,
        IVirtualizationSession session,
        string                 sessionId,
        ILogger                logger,
        CancellationToken      ct)
    {
        try
        {
            while (!ct.IsCancellationRequested)
            {
                var streamCtx = await wtSession.AcceptStreamAsync(ct);
                if (streamCtx is null) break;

                // Determine stream direction via IStreamDirectionFeature
                var dirFeature = streamCtx.Features.Get<IStreamDirectionFeature>();
                var canRead    = dirFeature?.CanRead  ?? true;
                var canWrite   = dirFeature?.CanWrite ?? false;

                if (canRead && canWrite)
                {
                    // Bidirectional → control stream
                    var readStream  = streamCtx.Transport.Input.AsStream();
                    var writeStream = streamCtx.Transport.Output.AsStream();
                    _ = HandleControlStreamAsync(readStream, writeStream, session, sessionId, logger, ct);
                }
                else if (canRead)
                {
                    // Client-initiated unidirectional → input stream
                    var readStream = streamCtx.Transport.Input.AsStream();
                    _ = HandleInputStreamAsync(readStream, session, sessionId, logger, ct);
                }
            }
        }
        catch (OperationCanceledException) { /* normal */ }
        catch (Exception ex) when (ex is not OutOfMemoryException)
        {
            logger.LogWarning(ex, "[{Id}] AcceptStreams error", sessionId);
        }
    }

    // ── Control stream (bidirectional) ────────────────────────────────────────

    private static async Task HandleControlStreamAsync(
        Stream                 readStream,
        Stream                 writeStream,
        IVirtualizationSession session,
        string                 sessionId,
        ILogger                logger,
        CancellationToken      ct)
    {
        // Run client-read and server-write concurrently on the same bidirectional stream.
        var readTask  = ReadControlCommandsAsync(readStream, session, sessionId, logger, ct);
        var writeTask = WriteControlMessagesAsync(writeStream, session, sessionId, logger, ct);
        await Task.WhenAll(readTask, writeTask);
    }

    private static async Task ReadControlCommandsAsync(
        Stream                 stream,
        IVirtualizationSession session,
        string                 sessionId,
        ILogger                logger,
        CancellationToken      ct)
    {
        var lenBuf = new byte[4];
        try
        {
            while (!ct.IsCancellationRequested)
            {
                // Read 4-byte length prefix
                if (!await ReadExactAsync(stream, lenBuf, ct)) break;
                var len = BitConverter.ToUInt32(lenBuf, 0);
                if (len == 0 || len > 1 * 1024 * 1024) break; // sanity cap: 1 MB

                var payload = new byte[len];
                if (!await ReadExactAsync(stream, payload, ct)) break;

                await DispatchControlCommandAsync(payload, session, sessionId, logger, ct);
            }
        }
        catch (OperationCanceledException) { /* normal */ }
        catch (Exception ex) when (ex is not OutOfMemoryException)
        {
            logger.LogWarning(ex, "[{Id}] Control read error", sessionId);
        }
    }

    private static async Task DispatchControlCommandAsync(
        byte[]                 payload,
        IVirtualizationSession session,
        string                 sessionId,
        ILogger                logger,
        CancellationToken      ct)
    {
        try
        {
            using var doc  = JsonDocument.Parse(payload);
            var type = doc.RootElement.GetProperty("type").GetString();

            switch (type)
            {
                case "navigate":
                    var url = doc.RootElement.GetProperty("url").GetString() ?? "";
                    await session.NavigateAsync(url);
                    break;

                case "refresh":
                    await session.RefreshAsync();
                    break;

                case "resize":
                    var w = doc.RootElement.GetProperty("width").GetInt32();
                    var h = doc.RootElement.GetProperty("height").GetInt32();
                    await session.ResizeAsync(w, h);
                    break;

                case "evaljs":
                case "goback":
                case "goforward":
                    // Forward directly to sidecar as raw JSON
                    await session.DispatchInputAsync(payload, ct);
                    break;
            }
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "[{Id}] Control command error", sessionId);
        }
    }

    private static async Task WriteControlMessagesAsync(
        Stream                 stream,
        IVirtualizationSession session,
        string                 sessionId,
        ILogger                logger,
        CancellationToken      ct)
    {
        try
        {
            await foreach (var msg in session.ControlChannel.ReadAllAsync(ct))
            {
                // Write raw binary message (MSG_URL / MSG_CONSOLE / MSG_EVAL_RESULT)
                // The client already knows how to parse these (same binary protocol).
                await stream.WriteAsync(msg, ct);
                await stream.FlushAsync(ct);
            }
        }
        catch (OperationCanceledException) { /* normal */ }
        catch (Exception ex) when (ex is not OutOfMemoryException)
        {
            logger.LogWarning(ex, "[{Id}] Control write error", sessionId);
        }
    }

    // ── Input stream (client-initiated unidirectional) ────────────────────────

    private static async Task HandleInputStreamAsync(
        Stream                 stream,
        IVirtualizationSession session,
        string                 sessionId,
        ILogger                logger,
        CancellationToken      ct)
    {
        var typeBuf  = new byte[1];
        var coordBuf = new byte[4]; // 2 bytes x + 2 bytes y
        var lenBuf   = new byte[4];

        try
        {
            while (!ct.IsCancellationRequested)
            {
                if (!await ReadExactAsync(stream, typeBuf, ct)) break;

                if (typeBuf[0] == 0x01)
                {
                    // Compact mouse move: [x uint16 LE][y uint16 LE]
                    if (!await ReadExactAsync(stream, coordBuf, ct)) break;
                    var x = BitConverter.ToUInt16(coordBuf, 0);
                    var y = BitConverter.ToUInt16(coordBuf, 2);

                    var json = JsonSerializer.SerializeToUtf8Bytes(
                        new { type = "mousemove", x = (int)x, y = (int)y });
                    await session.DispatchInputAsync(json, ct);
                }
                else if (typeBuf[0] == 0x02)
                {
                    // JSON event: [uint32 LE len][len bytes UTF-8 JSON]
                    if (!await ReadExactAsync(stream, lenBuf, ct)) break;
                    var len = BitConverter.ToUInt32(lenBuf, 0);
                    if (len == 0 || len > 64 * 1024) break;

                    var payload = new byte[len];
                    if (!await ReadExactAsync(stream, payload, ct)) break;
                    await session.DispatchInputAsync(payload, ct);
                }
                else
                {
                    logger.LogWarning("[{Id}] Unknown input event type: 0x{T:X2}", sessionId, typeBuf[0]);
                    break;
                }
            }
        }
        catch (OperationCanceledException) { /* normal */ }
        catch (Exception ex) when (ex is not OutOfMemoryException)
        {
            logger.LogWarning(ex, "[{Id}] Input stream error", sessionId);
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private static async Task<bool> ReadExactAsync(Stream stream, byte[] buf, CancellationToken ct)
    {
        int offset = 0;
        while (offset < buf.Length)
        {
            var read = await stream.ReadAsync(buf.AsMemory(offset), ct);
            if (read == 0) return false; // stream closed
            offset += read;
        }
        return true;
    }
}
