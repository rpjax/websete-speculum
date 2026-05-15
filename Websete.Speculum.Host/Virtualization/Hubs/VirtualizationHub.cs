using Microsoft.AspNetCore.SignalR;
using Websete.Speculum.Host.Virtualization.Services;

namespace Websete.Speculum.Host.Virtualization.Hubs;

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
    private readonly IVirtualizationService        _service;
    private readonly ILogger<VirtualizationHub>    _logger;

    public VirtualizationHub(
        IVirtualizationService     service,
        ILogger<VirtualizationHub> logger)
    {
        _service = service;
        _logger  = logger;
    }

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
        // Wrap cleanup so that any failure does NOT prevent base.OnDisconnectedAsync
        // from running — if the base call is skipped, SignalR cannot clean up its
        // own connection state (group memberships, connection tracking, etc.).
        try
        {
            await _service.CleanupConnectionAsync(Context.ConnectionId);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex,
                "Error cleaning up sessions for connection {Conn}", Context.ConnectionId);
        }

        await base.OnDisconnectedAsync(exception);
    }
}
