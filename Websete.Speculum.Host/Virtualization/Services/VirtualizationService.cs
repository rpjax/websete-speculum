using System.Collections.Concurrent;
using Websete.Speculum.Browser;
using Websete.Speculum.Host.Config;
using Websete.Speculum.Host.Rewriting;
using Websete.Speculum.Host.ScriptInjection;

namespace Websete.Speculum.Host.Virtualization.Services;

/// <summary>
/// Orchestrates the full lifecycle of virtualization sessions.
/// Session cleanup is triggered by the WebTransport handler on disconnect.
/// </summary>
public sealed class VirtualizationService : IVirtualizationService, IAsyncDisposable
{
    private readonly ConcurrentDictionary<string, IVirtualizationSession> _sessions = new();
    private readonly SidecarService                _sidecar;
    private readonly ScriptInjectionService        _scriptInjection;
    private readonly IUrlRewriter                  _rewriter;
    private readonly SpeculumConfig                _config;
    private readonly ILogger<VirtualizationService> _logger;

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

    public async Task<CreateSessionResponse> CreateSessionAsync(CreateSessionRequest request)
    {
        if (_sessions.Count >= _config.MaxSessions)
            throw new InvalidOperationException(
                $"Session limit reached ({_config.MaxSessions}).");

        var sessionId  = Guid.NewGuid().ToString();
        _logger.LogInformation("[{Id}] Creating session", sessionId);

        var resolvedUrl = RewriteUrl(sessionId, request.InitialUrl);

        var scripts = _scriptInjection.Scripts
            .Select(s => new ScriptPayload(s.Position, s.Type, s.File, s.Content))
            .ToList();

        var jsBridgeEnabled = _config.JsBridge.Enable;

        var sidecarSession = await _sidecar.CreateSessionAsync(
            sessionId, request.Width, request.Height, resolvedUrl, scripts, jsBridgeEnabled);

        var session = new VirtualizationSession(sidecarSession);
        _sessions[sessionId] = session;

        _logger.LogInformation("[{Id}] Session ready", sessionId);
        return new CreateSessionResponse(sessionId, request.Width, request.Height, jsBridgeEnabled);
    }

    public IVirtualizationSession? GetSession(string sessionId)
        => _sessions.TryGetValue(sessionId, out var s) ? s : null;

    public async Task NavigateAsync(NavigateRequest request)
        => await Require(request.SessionId).NavigateAsync(request.Url);

    public async Task RefreshAsync(RefreshRequest request)
        => await Require(request.SessionId).RefreshAsync();

    public async Task ResizeAsync(ResizeRequest request)
        => await Require(request.SessionId).ResizeAsync(request.Width, request.Height);

    public async Task CloseSessionAsync(string sessionId)
    {
        if (_sessions.TryRemove(sessionId, out var session))
        {
            _logger.LogInformation("[{Id}] Closing session", sessionId);
            await session.DisposeAsync();
        }
    }

    public async ValueTask DisposeAsync()
    {
        foreach (var session in _sessions.Values)
            try { await session.DisposeAsync(); } catch { /* best-effort */ }
        _sessions.Clear();
    }

    private IVirtualizationSession Require(string sessionId)
        => GetSession(sessionId)
           ?? throw new InvalidOperationException($"Session '{sessionId}' not found.");

    private string? RewriteUrl(string sessionId, string? rawUrl)
    {
        if (string.IsNullOrWhiteSpace(rawUrl)) return null;
        if (!Uri.TryCreate(rawUrl, UriKind.Absolute, out var uri))
        {
            _logger.LogWarning("[{Id}] Invalid URL: {Url}", sessionId, rawUrl);
            return rawUrl;
        }
        var rewritten = _rewriter.Rewrite(rawUrl, uri.Host);
        if (rewritten is null)
        {
            _logger.LogWarning("[{Id}] No profile matched host '{Host}'", sessionId, uri.Host);
            return null;
        }
        if (!string.Equals(rewritten, rawUrl, StringComparison.Ordinal))
            _logger.LogInformation("[{Id}] URL rewritten: {From} → {To}", sessionId, rawUrl, rewritten);
        return rewritten;
    }
}

