using System.Threading.Channels;

namespace Websete.Speculum.Host.Services;

// ── Request / response records ────────────────────────────────────────────────

/// <summary>Payload to open a new isolated browser session.</summary>
public record CreateSessionRequest(int Width = 1280, int Height = 720, string? InitialUrl = null);

/// <summary>Returned after the session is ready on the sidecar.</summary>
public record CreateSessionResponse(string SessionId, int Width, int Height);

/// <summary>Asks the server to reload the current page.</summary>
public record RefreshRequest(string SessionId);

/// <summary>Resizes the browser viewport for the given session.</summary>
public record ResizeRequest(string SessionId, int Width, int Height);

/// <summary>Navigates the session's browser to a URL.</summary>
public record NavigateRequest(string SessionId, string Url);

// ── Session interface ─────────────────────────────────────────────────────────

/// <summary>
/// Represents one active virtualization session backed by the Node.js sidecar.
/// Exposes a frame channel for relaying binary frames to the browser client.
/// </summary>
public interface IVirtualizationSession : IAsyncDisposable
{
    string SessionId { get; }
    int    Width     { get; }
    int    Height    { get; }

    /// <summary>Channel of raw binary frame messages (tile/full/skip) from the sidecar.</summary>
    ChannelReader<ReadOnlyMemory<byte>> FrameChannel { get; }

    Task NavigateAsync(string url);
    Task RefreshAsync();
    Task ResizeAsync(int width, int height);

    /// <summary>
    /// Forwards a raw JSON input message (mousemove, keydown, etc.) from the
    /// browser client directly to the sidecar.
    /// </summary>
    Task DispatchInputAsync(string json, CancellationToken ct = default);
}

// ── Service interface ─────────────────────────────────────────────────────────

/// <summary>
/// Orchestrates browser session lifecycle.
/// The SignalR hub is a thin controller; all logic lives here.
/// </summary>
public interface IVirtualizationService
{
    /// <summary>Creates a new browser session on the sidecar.</summary>
    Task<CreateSessionResponse> CreateSessionAsync(CreateSessionRequest request, string connectionId);

    /// <summary>Retrieves an active session by ID, or <c>null</c>.</summary>
    IVirtualizationSession? GetSession(string sessionId);

    /// <summary>Navigates the session's browser to a URL.</summary>
    Task NavigateAsync(NavigateRequest request);

    /// <summary>Reloads the page in the identified session.</summary>
    Task RefreshAsync(RefreshRequest request);

    /// <summary>Resizes the browser viewport.</summary>
    Task ResizeAsync(ResizeRequest request);

    /// <summary>Terminates a session and releases all resources.</summary>
    Task CloseSessionAsync(string sessionId);

    /// <summary>
    /// Called by <c>OnDisconnectedAsync</c> — terminates every session
    /// owned by the given SignalR connection.
    /// </summary>
    Task CleanupConnectionAsync(string connectionId);
}
