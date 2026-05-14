using System.Collections.Concurrent;
using Websete.Speculum.Browser;

namespace Websete.Speculum.Host.Services;

/// <summary>
/// Orchestrates the full lifecycle of virtualization sessions.
///
/// Responsibilities:
///   • Create / look up / close <see cref="VirtualizationSession"/> instances.
///   • Map SignalR connection IDs to sessions for automatic cleanup on disconnect.
///
/// No WebRTC, no ICE candidates, no SignalR push from this layer —
/// the frame relay is handled by <c>ClientWebSocketHandler</c> directly
/// reading from <see cref="IVirtualizationSession.FrameChannel"/>.
/// </summary>
public sealed class VirtualizationService : IVirtualizationService, IAsyncDisposable
{
    private sealed record Entry(IVirtualizationSession Session, string ConnectionId);

    private readonly ConcurrentDictionary<string, Entry> _sessions = new();
    private readonly SidecarService                      _sidecar;
    private readonly ILogger<VirtualizationService>      _logger;

    public VirtualizationService(SidecarService sidecar, ILogger<VirtualizationService> logger)
    {
        _sidecar = sidecar;
        _logger  = logger;
    }

    // ── IVirtualizationService ────────────────────────────────────────────────

    public async Task<CreateSessionResponse> CreateSessionAsync(
        CreateSessionRequest request,
        string               connectionId)
    {
        var sessionId = Guid.NewGuid().ToString();
        _logger.LogInformation("[{Id}] Creating session for connection {Conn}", sessionId, connectionId);

        var sidecarSession = await _sidecar.CreateSessionAsync(
            sessionId,
            request.Width,
            request.Height,
            request.InitialUrl);

        var session = new VirtualizationSession(sidecarSession);
        _sessions[sessionId] = new Entry(session, connectionId);

        _logger.LogInformation("[{Id}] Session ready", sessionId);
        return new CreateSessionResponse(sessionId, request.Width, request.Height);
    }

    public IVirtualizationSession? GetSession(string sessionId)
        => _sessions.TryGetValue(sessionId, out var e) ? e.Session : null;

    public async Task NavigateAsync(NavigateRequest request)
    {
        var session = Require(request.SessionId);
        await session.NavigateAsync(request.Url);
    }

    public async Task RefreshAsync(RefreshRequest request)
        => await Require(request.SessionId).RefreshAsync();

    public async Task ResizeAsync(ResizeRequest request)
        => await Require(request.SessionId).ResizeAsync(request.Width, request.Height);

    public async Task CloseSessionAsync(string sessionId)
    {
        if (_sessions.TryRemove(sessionId, out var entry))
        {
            _logger.LogInformation("[{Id}] Closing session", sessionId);
            await entry.Session.DisposeAsync();
        }
    }

    public async Task CleanupConnectionAsync(string connectionId)
    {
        var owned = _sessions
            .Where(kv => kv.Value.ConnectionId == connectionId)
            .Select(kv => kv.Key)
            .ToList();

        foreach (var sessionId in owned)
            await CloseSessionAsync(sessionId);
    }

    // ── IAsyncDisposable ──────────────────────────────────────────────────────

    public async ValueTask DisposeAsync()
    {
        foreach (var entry in _sessions.Values)
        {
            try { await entry.Session.DisposeAsync(); } catch { /* best-effort */ }
        }
        _sessions.Clear();
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private IVirtualizationSession Require(string sessionId)
        => GetSession(sessionId)
           ?? throw new InvalidOperationException($"Session '{sessionId}' not found.");
}
