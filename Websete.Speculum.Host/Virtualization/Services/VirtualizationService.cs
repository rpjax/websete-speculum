using System.Collections.Concurrent;
using Websete.Speculum.Browser;
using Websete.Speculum.Host.Config;
using Websete.Speculum.Host.Rewriting;
using Websete.Speculum.Host.ScriptInjection;

namespace Websete.Speculum.Host.Virtualization.Services;

/// <summary>
/// Orchestrates the full lifecycle of virtualization sessions.
///
/// Responsibilities:
///   • Create / look up / close <see cref="VirtualizationSession"/> instances.
///   • Map SignalR connection IDs to sessions for automatic cleanup on disconnect.
///   • Apply URL rewriting via <see cref="IUrlRewriter"/> so the virtual browser
///     opens the upstream (real) site instead of the downstream (proxied) domain.
///
/// Frame relay is handled by <c>ClientWebSocketHandler</c> directly reading
/// from <see cref="IVirtualizationSession.FrameChannel"/>.
/// </summary>
public sealed class VirtualizationService : IVirtualizationService, IAsyncDisposable
{
    private sealed record Entry(IVirtualizationSession Session, string ConnectionId);

    private readonly ConcurrentDictionary<string, Entry> _sessions = new();
    private readonly SidecarService                      _sidecar;
    private readonly ScriptInjectionService              _scriptInjection;
    private readonly IUrlRewriter                        _rewriter;
    private readonly SpeculumConfig                      _config;
    private readonly ILogger<VirtualizationService>      _logger;

    public VirtualizationService(
        SidecarService                 sidecar,
        ScriptInjectionService         scriptInjection,
        IUrlRewriter                   rewriter,
        SpeculumConfig                 config,
        ILogger<VirtualizationService> logger)
    {
        _sidecar         = sidecar;
        _scriptInjection = scriptInjection;
        _rewriter        = rewriter;
        _config          = config;
        _logger          = logger;
    }

    // ── IVirtualizationService ────────────────────────────────────────────────

    public async Task<CreateSessionResponse> CreateSessionAsync(
        CreateSessionRequest request,
        string               connectionId)
    {
        // Enforce the configured session cap before allocating any resources.
        if (_sessions.Count >= _config.MaxSessions)
            throw new InvalidOperationException(
                $"Session limit reached ({_config.MaxSessions}). " +
                "No new sessions can be created until an existing one is closed.");

        var sessionId = Guid.NewGuid().ToString();
        _logger.LogInformation("[{Id}] Creating session for connection {Conn}",
            sessionId, connectionId);

        // Rewrite the initial URL through the MITM forwarding rules.
        // The client sends its own page URL (window.location.href); the
        // rewriter replaces the downstream domain with the upstream domain
        // while preserving the path and query string verbatim.
        //
        // Example:
        //   "https://www.websete.localhost/cars?q=1"
        //   → "https://www.olx.com.br/cars?q=1"
        var resolvedUrl = RewriteUrl(sessionId, request.InitialUrl);

        // Map resolved scripts to the DTO expected by SidecarClient.
        // Content is already loaded in memory by ScriptInjectionService at startup.
        var scripts = _scriptInjection.Scripts
            .Select(s => new ScriptPayload(s.Position, s.Type, s.File, s.Content))
            .ToList();

        if (scripts.Count > 0)
            _logger.LogInformation("[{Id}] Injecting {Count} script(s) into session",
                sessionId, scripts.Count);

        var jsBridgeEnabled = _config.JsBridge.Enable;

        var sidecarSession = await _sidecar.CreateSessionAsync(
            sessionId,
            request.Width,
            request.Height,
            resolvedUrl,
            scripts,
            jsBridgeEnabled);

        var session = new VirtualizationSession(sidecarSession);
        _sessions[sessionId] = new Entry(session, connectionId);

        _logger.LogInformation("[{Id}] Session ready (JsBridge={JsBridge})", sessionId, jsBridgeEnabled);
        return new CreateSessionResponse(sessionId, request.Width, request.Height, jsBridgeEnabled);
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

    /// <summary>
    /// Parses <paramref name="rawUrl"/>, extracts the host, and asks the
    /// rewriter to apply the matching forwarding profile's rules.
    /// Returns <c>null</c> when no URL is provided or no profile matched.
    /// </summary>
    private string? RewriteUrl(string sessionId, string? rawUrl)
    {
        if (string.IsNullOrWhiteSpace(rawUrl))
            return null;

        if (!Uri.TryCreate(rawUrl, UriKind.Absolute, out var uri))
        {
            _logger.LogWarning("[{Id}] InitialUrl is not a valid absolute URI: {Url}",
                sessionId, rawUrl);
            return rawUrl;
        }

        var rewritten = _rewriter.Rewrite(rawUrl, uri.Host);

        if (rewritten is null)
        {
            _logger.LogWarning(
                "[{Id}] No forwarding profile matched host '{Host}'; " +
                "opening session without navigation.",
                sessionId, uri.Host);
            return null;
        }

        if (!string.Equals(rewritten, rawUrl, StringComparison.Ordinal))
        {
            _logger.LogInformation("[{Id}] URL rewritten: {From} → {To}",
                sessionId, rawUrl, rewritten);
        }

        return rewritten;
    }
}
