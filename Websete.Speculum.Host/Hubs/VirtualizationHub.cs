using Microsoft.AspNetCore.SignalR;
using Websete.Speculum.Host.Services;

namespace Websete.Speculum.Host.Hubs;

/// <summary>
/// SignalR hub — thin controller. All business logic lives in
/// <see cref="IVirtualizationService"/>.
///
/// Control plane only: session lifecycle and navigation.
/// Frame streaming and input forwarding use the dedicated binary WebSocket
/// endpoint at /ws/{sessionId} (see ClientWebSocketHandler).
/// </summary>
public sealed class VirtualizationHub : Hub
{
    private readonly IVirtualizationService _service;

    public VirtualizationHub(IVirtualizationService service)
        => _service = service;

    // ── Session lifecycle ─────────────────────────────────────────────────────

    /// <summary>
    /// Creates a new browser session on the sidecar.
    /// Returns the session ID and dimensions — the client uses the session ID
    /// to open /ws/{sessionId} for binary frame streaming.
    /// </summary>
    public Task<CreateSessionResponse> CreateSessionAsync(CreateSessionRequest request)
        => _service.CreateSessionAsync(request, Context.ConnectionId);

    public Task NavigateAsync(NavigateRequest request)
        => _service.NavigateAsync(request);

    public Task RefreshAsync(RefreshRequest request)
        => _service.RefreshAsync(request);

    public Task ResizeAsync(ResizeRequest request)
        => _service.ResizeAsync(request);

    public Task CloseSessionAsync(string sessionId)
        => _service.CloseSessionAsync(sessionId);

    // ── Disconnect cleanup ────────────────────────────────────────────────────

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        await _service.CleanupConnectionAsync(Context.ConnectionId);
        await base.OnDisconnectedAsync(exception);
    }
}
