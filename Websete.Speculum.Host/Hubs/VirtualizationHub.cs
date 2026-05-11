using Microsoft.AspNetCore.SignalR;
using Websete.Speculum.Browser;
using Websete.Speculum.Host.WebRtc;

namespace Websete.Speculum.Host.Hubs;

/// <summary>
/// SignalR hub — the exclusive signaling channel for WebRTC session management.
///
/// Responsibilities:
///   • Session lifecycle  (CreateSession / TerminateSession)
///   • WebRTC handshake  (SendOffer → returns answer)
///   • ICE forwarding    (AddIceCandidate)
///
/// High-performance data (H.264 video, input events) flows over the WebRTC
/// peer connection itself — not through this hub.
///
/// Hub instances are transient (one per invocation), so all persistent state
/// lives in the injected singletons <see cref="BrowserService"/> and
/// <see cref="SessionRegistry"/>.
/// </summary>
public sealed class VirtualizationHub : Hub
{
    private readonly BrowserService  _browserService;
    private readonly SessionRegistry _registry;
    private readonly ILoggerFactory  _loggerFactory;
    private readonly ILogger         _logger;

    public VirtualizationHub(
        BrowserService  browserService,
        SessionRegistry registry,
        ILoggerFactory  loggerFactory)
    {
        _browserService = browserService;
        _registry       = registry;
        _loggerFactory  = loggerFactory;
        _logger         = loggerFactory.CreateLogger<VirtualizationHub>();
    }

    // ── Session lifecycle ─────────────────────────────────────────────────────

    /// <summary>
    /// Creates a browser session and registers its WebRTC peer connection.
    /// If a session with the same <paramref name="sessionId"/> already exists it is
    /// terminated first so resources are never leaked by duplicate calls.
    /// Must be called before <see cref="SendOffer"/>.
    /// </summary>
    public async Task CreateSession(
        string sessionId,
        int    width  = 1280,
        int    height = 720)
    {
        _logger.LogInformation("[{Id}] CreateSession — connection {Conn}",
            sessionId, Context.ConnectionId);

        // Guard: if a session with this ID already exists (e.g. page refresh without
        // explicit cleanup), tear it down before creating the new one.
        if (_registry.Get(sessionId) is not null)
        {
            _logger.LogWarning(
                "[{Id}] Session already exists — terminating stale session before recreating",
                sessionId);
            await TerminateSession(sessionId);
        }

        var browser    = await _browserService.CreateSessionAsync(sessionId, width, height);
        var rtcSession = new WebRtcSession(
            browser,
            _loggerFactory.CreateLogger("WebRtcSession"));

        // Forward SIPSorcery's outbound signals (answer, ICE) back to this client.
        rtcSession.OnSignalMessage += async msg =>
        {
            try   { await Clients.Caller.SendAsync("Signal", msg); }
            catch (Exception ex)
            {
                _logger.LogWarning(ex,
                    "[{Id}] Failed to forward signal to client", sessionId);
            }
        };

        _registry.Register(sessionId, Context.ConnectionId, rtcSession);
    }

    /// <summary>
    /// Processes the client's WebRTC offer SDP and returns the server's answer SDP.
    /// </summary>
    public async Task<string> SendOffer(string sessionId, string sdp)
    {
        var rtc = _registry.Get(sessionId)
            ?? throw new HubException($"Session '{sessionId}' not found. Call CreateSession first.");

        return await rtc.HandleOfferAsync(sdp);
    }

    /// <summary>
    /// Forwards an ICE candidate from the client browser to SIPSorcery.
    /// </summary>
    public void AddIceCandidate(
        string  sessionId,
        string  candidate,
        string? sdpMid,
        int     sdpMLineIndex)
    {
        _registry.Get(sessionId)
                 ?.AddIceCandidate(candidate, sdpMid, (ushort)sdpMLineIndex);
    }

    /// <summary>
    /// Tears down the session and releases all resources (Xvfb, FFmpeg, browser).
    /// </summary>
    public async Task TerminateSession(string sessionId)
    {
        _logger.LogInformation("[{Id}] TerminateSession", sessionId);

        if (_registry.TryRemove(sessionId, out var rtc))
            await rtc!.DisposeAsync();

        await _browserService.TerminateSessionAsync(sessionId);
    }

    // ── Disconnection ─────────────────────────────────────────────────────────

    /// <summary>
    /// Called when the SignalR connection drops (browser tab closed, network loss, etc.).
    /// Cleans up every session owned by this connection so resources are never leaked.
    /// </summary>
    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        _logger.LogInformation(
            "Connection {Conn} disconnected — cleaning up sessions", Context.ConnectionId);

        foreach (var sessionId in _registry.GetByConnection(Context.ConnectionId))
        {
            try   { await TerminateSession(sessionId); }
            catch (Exception ex)
            {
                _logger.LogWarning(ex,
                    "[{Id}] Error during disconnect cleanup", sessionId);
            }
        }

        await base.OnDisconnectedAsync(exception);
    }
}
