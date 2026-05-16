using System.Net.WebSockets;
using System.Text.Json;
using System.Threading.Channels;

namespace Websete.Speculum.Browser;

/// <summary>
/// Represents a single script to be injected into every page of the session.
/// The sidecar receives this via the "create" handshake payload.
/// </summary>
/// <param name="Position">
/// Injection position: <c>HeaderTop</c>, <c>HeaderBottom</c>, <c>BodyTop</c>, or <c>BodyBottom</c>.
/// Controls execution timing via <c>addInitScript</c> wrapping in the sidecar.
/// </param>
/// <param name="Type">Script type: <c>Classic</c> or <c>Module</c>.</param>
/// <param name="Content">Literal JavaScript source to inject.</param>
public sealed record ScriptPayload(string Position, string Type, string Content);

/// <summary>
/// Manages the WebSocket connection from the .NET app to the Node.js sidecar
/// for one browser session.
///
/// Responsibilities:
///   • Sends the "create" handshake and waits for "ready".
///   • Runs a background receive loop that publishes binary frame messages
///     to <see cref="FrameChannel"/> (read by the client WS relay).
///   • Exposes <see cref="SendInputAsync"/> for forwarding input bytes from
///     the browser client — zero allocation, no UTF-8 round-trip.
///
/// Thread safety:
///   Concurrent senders (SignalR hub methods + WS relay loop) are serialised
///   through <see cref="_sendLock"/> because <see cref="ClientWebSocket"/>
///   only allows one outstanding SendAsync at a time.
/// </summary>
public sealed class SidecarClient : IAsyncDisposable
{
    private readonly ClientWebSocket               _ws        = new();
    private readonly CancellationTokenSource       _cts       = new();
    private readonly Channel<ReadOnlyMemory<byte>> _frames;
    private readonly SemaphoreSlim                 _sendLock  = new(1, 1);

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

        // Build and send the session-create command.
        // SerializeToUtf8Bytes goes directly to UTF-8 bytes; no intermediate string.
        //
        // The scripts array carries the literal JS content of every configured
        // ScriptInjection entry. The sidecar installs them via context.addInitScript()
        // so they run on every navigation for the lifetime of the session.
        var scriptDtos = (scripts ?? [])
            .Select(s => new { position = s.Position, type = s.Type, content = s.Content })
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

            var text   = System.Text.Encoding.UTF8.GetString(buf, 0, filled);
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

    /// <summary>
    /// Forwards raw UTF-8 JSON bytes to the sidecar as a Text WebSocket frame.
    ///
    /// This is the zero-allocation hot path: callers pass the raw bytes they
    /// already have (received from the browser WS, or from
    /// <see cref="JsonSerializer.SerializeToUtf8Bytes"/>) without any string
    /// intermediary or re-encoding.
    ///
    /// Thread-safe: concurrent callers (SignalR hub + WS relay loop) are
    /// serialised through <see cref="_sendLock"/>.
    /// </summary>
    public Task SendInputAsync(ReadOnlyMemory<byte> raw, CancellationToken ct = default)
        => SendCoreAsync(raw, ct);

    /// <summary>
    /// Core send — all outgoing messages go through here so the
    /// <see cref="_sendLock"/> guarantees only one outstanding
    /// <see cref="ClientWebSocket.SendAsync"/> at a time.
    /// </summary>
    private async Task SendCoreAsync(ReadOnlyMemory<byte> data, CancellationToken ct)
    {
        // Acquire the send lock before checking state to avoid a TOCTOU race
        // where the socket closes between the check and the send.
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
            _sendLock.Dispose();
        }
    }
}
