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
    private readonly ClientWebSocket               _ws     = new();
    private readonly CancellationTokenSource       _cts    = new();
    private readonly Channel<ReadOnlyMemory<byte>> _frames;

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
            FullMode     = BoundedChannelFullMode.DropOldest,
            SingleWriter = true,
            SingleReader = true,
        });
    }

    // ── Connection ────────────────────────────────────────────────────────────

    /// <summary>
    /// Connects to the sidecar WebSocket, sends the "create" command, and
    /// waits for the "ready" acknowledgement before returning.
    ///
    /// Throws <see cref="TimeoutException"/> if the sidecar does not respond
    /// within 30 seconds (e.g. Xvfb or Chrome failed to start).
    /// </summary>
    public async Task ConnectAsync(
        string  sidecarBaseUrl,
        int     width,
        int     height,
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
        // Hard timeout: Xvfb + Chrome launch typically completes in < 5 s.
        // 30 s gives ample headroom on slow machines / cold Docker images.
        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeoutCts.CancelAfter(TimeSpan.FromSeconds(30));
        var timeoutCt = timeoutCts.Token;

        // Accumulate fragmented WebSocket text messages before parsing.
        var buf    = new byte[64 * 1024];
        int filled = 0;

        while (true)
        {
            if (filled == buf.Length)
                Array.Resize(ref buf, buf.Length * 2);

            ValueWebSocketReceiveResult result;
            try
            {
                result = await _ws.ReceiveAsync(buf.AsMemory(filled), timeoutCt);
            }
            catch (OperationCanceledException) when (
                timeoutCts.IsCancellationRequested && !ct.IsCancellationRequested)
            {
                // The 30-second timeout fired — sidecar did not become ready.
                throw new TimeoutException(
                    $"Sidecar did not become ready within 30 s (session {SessionId}). " +
                    "Check sidecar logs for Xvfb or Chrome startup errors.");
            }

            if (result.MessageType == WebSocketMessageType.Close)
                throw new InvalidOperationException(
                    $"Sidecar closed connection before reporting ready (session {SessionId}).");

            if (result.MessageType != WebSocketMessageType.Text)
            {
                // Binary frames before ready are unexpected — skip them.
                filled = 0;
                continue;
            }

            filled += result.Count;

            if (!result.EndOfMessage) continue; // wait for full message

            var text = Encoding.UTF8.GetString(buf, 0, filled);
            filled = 0; // reset for next message

            string? type;
            try
            {
                using var doc = JsonDocument.Parse(text);
                type = doc.RootElement.GetProperty("type").GetString();

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
                    $"Sidecar sent malformed JSON during handshake " +
                    $"(session {SessionId}): {ex.Message}. Raw: {text[..Math.Min(text.Length, 200)]}");
            }

            // Any other message type during handshake is ignored (forward-compatible).
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
        var buf    = new byte[64 * 1024];
        int filled = 0;

        // Safety cap: reject messages larger than this to prevent unbounded
        // memory growth from a misbehaving sidecar.
        const int MaxFrameSize = 32 * 1024 * 1024; // 32 MB

        try
        {
            while (!ct.IsCancellationRequested && _ws.State == WebSocketState.Open)
            {
                if (filled == buf.Length)
                {
                    if (buf.Length >= MaxFrameSize)
                    {
                        // Incoming frame exceeds the safety cap — discard and resync.
                        Console.Error.WriteLine(
                            $"[SidecarClient:{SessionId}] Frame exceeded {MaxFrameSize / 1024 / 1024} MB; discarding.");
                        filled = 0;
                        // Continue receiving to drain the oversized message.
                    }
                    else
                    {
                        Array.Resize(ref buf, Math.Min(buf.Length * 2, MaxFrameSize));
                    }
                }

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
                // Text frames (e.g. "ready") are only expected during handshake —
                // ignore any that arrive after the receive loop starts.

                filled = 0;
            }
        }
        catch (OperationCanceledException) { /* normal shutdown */ }
        catch (Exception ex) when (ex is not OutOfMemoryException)
        {
            Console.Error.WriteLine(
                $"[SidecarClient:{SessionId}] Receive loop error: {ex.Message}");
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
                await _ws.CloseAsync(
                    WebSocketCloseStatus.NormalClosure, "session ended",
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
