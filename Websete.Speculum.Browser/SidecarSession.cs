using System.Text.Json;
using System.Threading.Channels;

namespace Websete.Speculum.Browser;

/// <summary>
/// High-level abstraction over <see cref="SidecarClient"/> that exposes
/// the API consumed by the Host layer (VirtualizationSession, WS handler).
/// </summary>
public sealed class SidecarSession : IAsyncDisposable
{
    private readonly SidecarClient _client;

    public string SessionId { get; }
    public int    Width     { get; }
    public int    Height    { get; }

    /// <summary>
    /// Readable channel of raw binary frame messages from the sidecar.
    /// The client WebSocket relay consumes this and forwards bytes to the browser.
    /// </summary>
    public ChannelReader<ReadOnlyMemory<byte>> FrameChannel => _client.FrameChannel;

    public SidecarSession(string sessionId, int width, int height, SidecarClient client)
    {
        SessionId = sessionId;
        Width     = width;
        Height    = height;
        _client   = client;
    }

    // ── Browser control ───────────────────────────────────────────────────────
    // SerializeToUtf8Bytes goes directly to UTF-8 — no string intermediary.

    public Task NavigateAsync(string url, CancellationToken ct = default) =>
        _client.SendInputAsync(
            JsonSerializer.SerializeToUtf8Bytes(new { type = "navigate", url }),
            ct);

    public Task RefreshAsync(CancellationToken ct = default) =>
        _client.SendInputAsync(
            JsonSerializer.SerializeToUtf8Bytes(new { type = "refresh" }),
            ct);

    public Task ResizeAsync(int width, int height, CancellationToken ct = default) =>
        _client.SendInputAsync(
            JsonSerializer.SerializeToUtf8Bytes(new { type = "resize", width, height }),
            ct);

    // ── Input relay ───────────────────────────────────────────────────────────

    /// <summary>
    /// Forwards a raw UTF-8 JSON message received from the browser client
    /// directly to the sidecar — zero-copy: the original receive buffer is
    /// used as-is, with no string decode or re-encode.
    /// </summary>
    public Task DispatchInputAsync(ReadOnlyMemory<byte> raw, CancellationToken ct = default) =>
        _client.SendInputAsync(raw, ct);

    // ── Disposal ──────────────────────────────────────────────────────────────

    public ValueTask DisposeAsync() => _client.DisposeAsync();
}
