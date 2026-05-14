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

    public Task NavigateAsync(string url, CancellationToken ct = default) =>
        _client.SendInputAsync(JsonSerializer.Serialize(new { type = "navigate", url }), ct);

    public Task RefreshAsync(CancellationToken ct = default) =>
        _client.SendInputAsync(JsonSerializer.Serialize(new { type = "refresh" }), ct);

    public Task ResizeAsync(int width, int height, CancellationToken ct = default) =>
        _client.SendInputAsync(JsonSerializer.Serialize(new { type = "resize", width, height }), ct);

    // ── Input relay ───────────────────────────────────────────────────────────

    /// <summary>
    /// Forwards a raw JSON input message received from the browser client
    /// directly to the sidecar (navigate, mousemove, keydown, etc.).
    /// </summary>
    public Task DispatchInputAsync(string json, CancellationToken ct = default) =>
        _client.SendInputAsync(json, ct);

    // ── Disposal ──────────────────────────────────────────────────────────────

    public ValueTask DisposeAsync() => _client.DisposeAsync();
}
