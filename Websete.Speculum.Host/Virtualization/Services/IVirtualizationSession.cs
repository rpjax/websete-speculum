using System.Threading.Channels;

namespace Websete.Speculum.Host.Virtualization.Services;

// ── Request / response records ────────────────────────────────────────────────

public record CreateSessionRequest(int Width = 1280, int Height = 720, string? InitialUrl = null);
public record CreateSessionResponse(string SessionId, int Width, int Height, bool JsBridgeEnabled);
public record RefreshRequest(string SessionId);
public record ResizeRequest(string SessionId, int Width, int Height);
public record NavigateRequest(string SessionId, string Url);

// ── Session interface ─────────────────────────────────────────────────────────

/// <summary>
/// One active virtualization session backed by the Node.js sidecar.
///
/// VideoChannel   — H.264 video frames (MSG_H264 encoded) for WebTransport relay.
/// ControlChannel — URL / console / eval messages for WebTransport control stream.
/// </summary>
public interface IVirtualizationSession : IAsyncDisposable
{
    string SessionId { get; }
    int    Width     { get; }
    int    Height    { get; }

    /// <summary>H.264 video frames ready for relay to the WebTransport video stream.</summary>
    ChannelReader<ReadOnlyMemory<byte>> VideoChannel   { get; }

    /// <summary>Control messages (URL, console, eval results) for the control stream.</summary>
    ChannelReader<ReadOnlyMemory<byte>> ControlChannel { get; }

    Task NavigateAsync(string url);
    Task RefreshAsync();
    Task ResizeAsync(int width, int height);

    /// <summary>
    /// Forwards raw UTF-8 JSON bytes (input events) to the sidecar.
    /// Zero-copy: the original bytes are sent as-is without string decode.
    /// </summary>
    Task DispatchInputAsync(ReadOnlyMemory<byte> raw, CancellationToken ct = default);
}

// ── Service interface ─────────────────────────────────────────────────────────

public interface IVirtualizationService
{
    Task<CreateSessionResponse> CreateSessionAsync(CreateSessionRequest request);
    IVirtualizationSession? GetSession(string sessionId);
    Task NavigateAsync(NavigateRequest request);
    Task RefreshAsync(RefreshRequest request);
    Task ResizeAsync(ResizeRequest request);
    Task CloseSessionAsync(string sessionId);
}
