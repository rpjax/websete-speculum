using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;

namespace Websete.Speculum.Browser;

/// <summary>
/// Manages the WebSocket connection from the .NET app to the Node.js sidecar
/// for one browser session.
///
/// Responsibilities:
///   • Sends the "create" handshake and waits for "ready".
///   • Runs a background receive loop that publishes binary frame messages
///     to <see cref="FrameChannel"/> (read by the client WS relay).
///   • Exposes <see cref="SendInputAsync"/> for forwarding input JSON from
///     the browser client.
/// </summary>
public sealed class SidecarClient : IAsyncDisposable
{
    private readonly ClientWebSocket                     _ws  = new();
    private readonly CancellationTokenSource             _cts = new();
    private readonly Channel<ReadOnlyMemory<byte>>       _frames;

    public string SessionId { get; }

    /// <summary>
    /// Channel of raw binary frame messages received from the sidecar.
    /// The relay task reads from here and forwards to the browser client WS.
    /// </summary>
    public ChannelReader<ReadOnlyMemory<byte>> FrameChannel => _frames.Reader;

    public SidecarClient(string sessionId)
    {
        SessionId = sessionId;

        // Bounded channel: if the client relay falls behind (slow network,
        // slow client), drop the oldest frames so the queue never grows large.
        // 4 slots ≈ 67 ms at 60 fps — enough to absorb brief scheduling jitter
        // without letting stale frames accumulate.
        _frames = Channel.CreateBounded<ReadOnlyMemory<byte>>(new BoundedChannelOptions(4)
        {
            FullMode      = BoundedChannelFullMode.DropOldest,
            SingleWriter  = true,
            SingleReader  = true,
        });
    }

    // ── Connection ────────────────────────────────────────────────────────────

    /// <summary>
    /// Connects to the sidecar WebSocket, sends the "create" command, and
    /// waits for the "ready" acknowledgement before returning.
    /// </summary>
    public async Task ConnectAsync(
        string sidecarBaseUrl,
        int    width,
        int    height,
        string? initialUrl = null,
        CancellationToken ct = default)
    {
        var uri = new Uri(sidecarBaseUrl.TrimEnd('/'));

        await _ws.ConnectAsync(uri, ct);

        // Send the session create command.
        var create = JsonSerializer.Serialize(new
        {
            type      = "create",
            sessionId = SessionId,
            width,
            height,
            url       = initialUrl,
        });
        await SendTextAsync(create, ct);

        // Wait for the "ready" reply (or "error").
        await WaitForReadyAsync(ct);

        // Start the background receive loop.
        _ = ReceiveLoopAsync(_cts.Token);
    }

    private async Task WaitForReadyAsync(CancellationToken ct)
    {
        var buf = new byte[4096];

        while (true)
        {
            var result = await _ws.ReceiveAsync(buf.AsMemory(), ct);

            if (result.MessageType == WebSocketMessageType.Close)
                throw new InvalidOperationException(
                    $"Sidecar closed connection before ready (session {SessionId}).");

            if (result.MessageType != WebSocketMessageType.Text)
                continue; // ignore binary before ready

            var text = Encoding.UTF8.GetString(buf, 0, result.Count);
            using var doc = JsonDocument.Parse(text);
            var type = doc.RootElement.GetProperty("type").GetString();

            if (type == "ready")  return;
            if (type == "error")
            {
                var msg = doc.RootElement.TryGetProperty("message", out var m)
                    ? m.GetString() : "unknown error";
                throw new InvalidOperationException(
                    $"Sidecar reported error for session {SessionId}: {msg}");
            }
        }
    }

    // ── Receive loop ──────────────────────────────────────────────────────────

    /// <summary>
    /// Background task: reads binary frames from the sidecar WS and publishes
    /// them to <see cref="FrameChannel"/>. Runs until the connection closes or
    /// the CTS is cancelled.
    /// </summary>
    private async Task ReceiveLoopAsync(CancellationToken ct)
    {
        // Use a 64 KB initial buffer; grow as needed for large frames.
        var buf = new byte[64 * 1024];
        int filled = 0;

        try
        {
            while (!ct.IsCancellationRequested && _ws.State == WebSocketState.Open)
            {
                // Grow buffer if needed.
                if (filled == buf.Length)
                    Array.Resize(ref buf, buf.Length * 2);

                var result = await _ws.ReceiveAsync(buf.AsMemory(filled), ct);

                if (result.MessageType == WebSocketMessageType.Close)
                    break;

                filled += result.Count;

                if (!result.EndOfMessage) continue; // accumulate fragmented frames

                if (result.MessageType == WebSocketMessageType.Binary)
                {
                    // Copy into a fresh heap allocation for the channel.
                    var frame = new byte[filled];
                    buf.AsSpan(0, filled).CopyTo(frame);
                    _frames.Writer.TryWrite(frame.AsMemory());
                }
                // Text frames from the sidecar (e.g. "ready") are ignored here —
                // they are only expected during the handshake phase.

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
            _frames.Writer.TryComplete();
        }
    }

    // ── Sending ───────────────────────────────────────────────────────────────

    /// <summary>Forwards a JSON input/control message to the sidecar.</summary>
    public Task SendInputAsync(string json, CancellationToken ct = default)
        => SendTextAsync(json, ct);

    private async Task SendTextAsync(string text, CancellationToken ct)
    {
        if (_ws.State != WebSocketState.Open) return;

        var bytes = Encoding.UTF8.GetBytes(text);
        await _ws.SendAsync(bytes.AsMemory(), WebSocketMessageType.Text, true, ct);
    }

    // ── Disposal ──────────────────────────────────────────────────────────────

    public async ValueTask DisposeAsync()
    {
        await _cts.CancelAsync();
        _frames.Writer.TryComplete();

        try
        {
            if (_ws.State == WebSocketState.Open)
                await _ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "session ended",
                    CancellationToken.None);
        }
        catch { /* best-effort */ }
        finally
        {
            _ws.Dispose();
            _cts.Dispose();
        }
    }
}
