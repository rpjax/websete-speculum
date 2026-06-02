using System.Net.WebSockets;
using System.Text.Json;
using System.Threading.Channels;

namespace Websete.Speculum.Host.Virtualization.Sidecar;

/// <summary>
/// Protocol constants shared between sidecar and .NET.
/// </summary>
internal static class SidecarProtocol
{
    public const byte MsgSkip       = 0x03;
    public const byte MsgUrl        = 0x04;
    public const byte MsgConsole    = 0x05;
    public const byte MsgEvalResult = 0x06;
    public const byte MsgH264       = 0x07; // legacy — kept for compatibility
    public const byte MsgScreencast = 0x08; // CDP Page.startScreencast JPEG frames
}

/// <summary>
/// Represents a single script to be injected into every page of the session.
/// </summary>
public sealed record ScriptPayload(string Position, string Type, string File, string Content);

/// <summary>
/// Manages the WebSocket connection from .NET to the Node.js sidecar for one session.
///
/// Routes incoming messages to two typed channels:
///   VideoChannel   — MSG_SCREENCAST (0x08) JPEG frames from CDP Page.startScreencast
///   ControlChannel — MSG_URL (0x04) / MSG_CONSOLE (0x05) / MSG_EVAL_RESULT (0x06)
///
/// Outgoing input events (JSON text) are serialised through _sendLock.
/// </summary>
public sealed class SidecarClient : IAsyncDisposable
{
    private readonly ClientWebSocket                _ws       = new();
    private readonly CancellationTokenSource        _cts      = new();
    private readonly Channel<ReadOnlyMemory<byte>>  _video;
    private readonly Channel<ReadOnlyMemory<byte>>  _control;
    private readonly SemaphoreSlim                  _sendLock = new(1, 1);

    public string SessionId { get; }

    /// <summary>
    /// JPEG screencast frames from CDP Page.startScreencast.
    /// Wire format: [0x08][jpeg bytes…]
    /// Bounded capacity 2 with DropOldest — always delivers the latest frame.
    /// </summary>
    public ChannelReader<ReadOnlyMemory<byte>> VideoChannel   => _video.Reader;

    /// <summary>
    /// Control messages (MSG_URL / MSG_CONSOLE / MSG_EVAL_RESULT) in their
    /// original wire encoding (type byte + payload), ready for relay to the client.
    /// </summary>
    public ChannelReader<ReadOnlyMemory<byte>> ControlChannel => _control.Reader;

    public SidecarClient(string sessionId)
    {
        SessionId = sessionId;

        // Video: bounded, drop oldest — we want the latest frame, not a backlog.
        _video = Channel.CreateBounded<ReadOnlyMemory<byte>>(new BoundedChannelOptions(2)
        {
            FullMode     = BoundedChannelFullMode.DropOldest,
            SingleWriter = true,
            SingleReader = true,
        });

        // Control: unbounded — control messages are rare and must not be dropped.
        _control = Channel.CreateUnbounded<ReadOnlyMemory<byte>>(new UnboundedChannelOptions
        {
            SingleWriter = true,
            SingleReader = true,
        });
    }

    // ── Connection ────────────────────────────────────────────────────────────

    public async Task ConnectAsync(
        string                        sidecarBaseUrl,
        int                           width,
        int                           height,
        string?                       initialUrl      = null,
        IReadOnlyList<ScriptPayload>? scripts         = null,
        bool                          jsBridgeEnabled = false,
        CancellationToken             ct              = default)
    {
        var uri = new Uri(sidecarBaseUrl.TrimEnd('/'));
        await _ws.ConnectAsync(uri, ct);

        var scriptDtos = (scripts ?? [])
            .Select(s => new { position = s.Position, type = s.Type, file = s.File, content = s.Content })
            .ToArray();

        var createBytes = JsonSerializer.SerializeToUtf8Bytes(new
        {
            type            = "create",
            sessionId       = SessionId,
            width,
            height,
            url             = initialUrl,
            scripts         = scriptDtos,
            jsBridgeEnabled,
        });
        await SendCoreAsync(createBytes, ct);
        await WaitForReadyAsync(ct);
        _ = ReceiveLoopAsync(_cts.Token);
    }

    private async Task WaitForReadyAsync(CancellationToken ct)
    {
        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeoutCts.CancelAfter(TimeSpan.FromSeconds(30));
        var timeoutCt = timeoutCts.Token;

        var buf    = new byte[64 * 1024];
        int filled = 0;

        while (true)
        {
            if (filled == buf.Length) Array.Resize(ref buf, buf.Length * 2);

            ValueWebSocketReceiveResult result;
            try
            {
                result = await _ws.ReceiveAsync(buf.AsMemory(filled), timeoutCt);
            }
            catch (OperationCanceledException) when (
                timeoutCts.IsCancellationRequested && !ct.IsCancellationRequested)
            {
                throw new TimeoutException(
                    $"Sidecar did not become ready within 30 s (session {SessionId}).");
            }

            if (result.MessageType == WebSocketMessageType.Close)
                throw new InvalidOperationException(
                    $"Sidecar closed connection before reporting ready (session {SessionId}).");

            if (result.MessageType != WebSocketMessageType.Text) { filled = 0; continue; }

            filled += result.Count;
            if (!result.EndOfMessage) continue;

            var text   = System.Text.Encoding.UTF8.GetString(buf, 0, filled);
            filled = 0;

            try
            {
                using var doc = JsonDocument.Parse(text);
                var type = doc.RootElement.GetProperty("type").GetString();
                if (type == "ready") return;
                if (type == "error")
                {
                    var msg = doc.RootElement.TryGetProperty("message", out var m)
                        ? m.GetString() : "unknown error";
                    throw new InvalidOperationException(
                        $"Sidecar reported error for session {SessionId}: {msg}");
                }
            }
            catch (JsonException ex)
            {
                throw new InvalidOperationException(
                    $"Sidecar sent malformed JSON during handshake (session {SessionId}): {ex.Message}");
            }
        }
    }

    // ── Receive loop ──────────────────────────────────────────────────────────

    private async Task ReceiveLoopAsync(CancellationToken ct)
    {
        var buf    = new byte[256 * 1024]; // 256 KB initial — JPEG frames at 1080p can reach ~200 KB
        int filled = 0;
        const int MaxFrameSize = 64 * 1024 * 1024; // 64 MB hard cap

        try
        {
            while (!ct.IsCancellationRequested && _ws.State == WebSocketState.Open)
            {
                if (filled == buf.Length)
                {
                    if (buf.Length >= MaxFrameSize) { filled = 0; }
                    else Array.Resize(ref buf, Math.Min(buf.Length * 2, MaxFrameSize));
                }

                var result = await _ws.ReceiveAsync(buf.AsMemory(filled), ct);
                if (result.MessageType == WebSocketMessageType.Close) break;
                filled += result.Count;
                if (!result.EndOfMessage) continue;

                if (result.MessageType == WebSocketMessageType.Binary)
                    RouteFrame(buf, filled);

                filled = 0;
            }
        }
        catch (OperationCanceledException) { /* normal shutdown */ }
        catch (Exception ex) when (ex is not OutOfMemoryException)
        {
            Console.Error.WriteLine($"[SidecarClient:{SessionId}] Receive loop error: {ex.Message}");
        }
        finally
        {
            _video.Writer.TryComplete();
            _control.Writer.TryComplete();
        }
    }

    /// <summary>
    /// Routes a complete binary message to the appropriate channel based on
    /// the first byte (message type tag).
    /// </summary>
    private void RouteFrame(byte[] buf, int len)
    {
        if (len < 1) return;
        var type = buf[0];

        if (type == SidecarProtocol.MsgScreencast)
        {
            // Layout: [0] 0x08 | [1..] JPEG bytes
            // No length prefix — the WS frame boundary is the message delimiter.
            if (len < 2) return;
            var frame = new byte[len];
            Buffer.BlockCopy(buf, 0, frame, 0, len);
            _video.Writer.TryWrite(frame.AsMemory());
        }
        else if (type == SidecarProtocol.MsgH264)
        {
            // Legacy H.264 path — kept for forward-compatibility.
            if (len < 6) return;
            var dataLen = BitConverter.ToUInt32(buf, 2);
            if (6 + dataLen > len) return;
            var frame = new byte[len];
            Buffer.BlockCopy(buf, 0, frame, 0, len);
            _video.Writer.TryWrite(frame.AsMemory());
        }
        else if (type is SidecarProtocol.MsgUrl
                      or SidecarProtocol.MsgConsole
                      or SidecarProtocol.MsgEvalResult)
        {
            // Copy the raw control message — relay as-is to the control stream.
            var msg = new byte[len];
            Buffer.BlockCopy(buf, 0, msg, 0, len);
            _control.Writer.TryWrite(msg.AsMemory());
        }
        // MSG_SKIP (0x03) and legacy JPEG types (0x01, 0x02) are silently dropped.
    }

    // ── Sending ───────────────────────────────────────────────────────────────

    public Task SendInputAsync(ReadOnlyMemory<byte> raw, CancellationToken ct = default)
        => SendCoreAsync(raw, ct);

    private async Task SendCoreAsync(ReadOnlyMemory<byte> data, CancellationToken ct)
    {
        await _sendLock.WaitAsync(ct);
        try
        {
            if (_ws.State != WebSocketState.Open) return;
            await _ws.SendAsync(data, WebSocketMessageType.Text, true, ct);
        }
        finally
        {
            _sendLock.Release();
        }
    }

    // ── Disposal ──────────────────────────────────────────────────────────────

    public async ValueTask DisposeAsync()
    {
        await _cts.CancelAsync();
        _video.Writer.TryComplete();
        _control.Writer.TryComplete();

        try
        {
            // CloseOutputAsync (half-close): sends our close frame but does NOT
            // wait for the sidecar to echo one back.  The sidecar's ws.on('close')
            // fires as soon as it receives our close frame and starts disposal
            // immediately.  Using CloseAsync here would block DisposeAsync until
            // the sidecar finishes the handshake — adding unnecessary latency.
            if (_ws.State is WebSocketState.Open or WebSocketState.CloseReceived)
                await _ws.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "session ended",
                    CancellationToken.None);
        }
        catch { /* best-effort */ }
        finally
        {
            _ws.Dispose();
            _cts.Dispose();
            _sendLock.Dispose();
        }
    }
}
