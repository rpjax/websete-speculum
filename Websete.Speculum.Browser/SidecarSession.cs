using System.Text.Json;
using System.Threading.Channels;

namespace Websete.Speculum.Browser;

/// <summary>
/// High-level abstraction over SidecarClient.
/// Exposes typed channels for video and control messages, and a method
/// for dispatching raw input JSON to the sidecar.
/// </summary>
public sealed class SidecarSession : IAsyncDisposable
{
    private readonly SidecarClient _client;

    public string SessionId { get; }
    public int    Width     { get; }
    public int    Height    { get; }

    /// <summary>
    /// H.264 video frames (MSG_H264 encoded, ready for WebTransport relay).
    /// </summary>
    public ChannelReader<ReadOnlyMemory<byte>> VideoChannel   => _client.VideoChannel;

    /// <summary>
    /// Control messages (MSG_URL / MSG_CONSOLE / MSG_EVAL_RESULT) in wire encoding.
    /// </summary>
    public ChannelReader<ReadOnlyMemory<byte>> ControlChannel => _client.ControlChannel;

    public SidecarSession(string sessionId, int width, int height, SidecarClient client)
    {
        SessionId = sessionId;
        Width     = width;
        Height    = height;
        _client   = client;
    }

    // ── Browser control ───────────────────────────────────────────────────────

    public Task NavigateAsync(string url, CancellationToken ct = default) =>
        _client.SendInputAsync(
            JsonSerializer.SerializeToUtf8Bytes(new { type = "navigate", url }), ct);

    public Task RefreshAsync(CancellationToken ct = default) =>
        _client.SendInputAsync(
            JsonSerializer.SerializeToUtf8Bytes(new { type = "refresh" }), ct);

    public Task ResizeAsync(int width, int height, CancellationToken ct = default) =>
        _client.SendInputAsync(
            JsonSerializer.SerializeToUtf8Bytes(new { type = "resize", width, height }), ct);

    // ── Input relay ───────────────────────────────────────────────────────────

    public Task DispatchInputAsync(ReadOnlyMemory<byte> raw, CancellationToken ct = default) =>
        _client.SendInputAsync(raw, ct);

    // ── Disposal ──────────────────────────────────────────────────────────────

    public ValueTask DisposeAsync() => _client.DisposeAsync();
}
