using System.Collections.Concurrent;

namespace Websete.Speculum.Browser;

/// <summary>
/// Registry and factory for <see cref="SidecarSession"/> instances.
///
/// One SidecarService is registered as a singleton. It owns all active sessions
/// and is responsible for creating, looking up, and terminating them.
/// </summary>
public sealed class SidecarService : IAsyncDisposable
{
    private readonly ConcurrentDictionary<string, SidecarSession> _sessions = new();

    /// <summary>Base WebSocket URL of the Node.js sidecar, e.g. "ws://sidecar:3000".</summary>
    public string SidecarBaseUrl { get; init; } = "ws://sidecar:3000";

    public int ActiveSessions => _sessions.Count;

    // ── Session lifecycle ─────────────────────────────────────────────────────

    /// <summary>
    /// Creates a new browser session: connects to the sidecar, sends the
    /// "create" command, and waits for the sidecar to confirm readiness.
    /// </summary>
    public async Task<SidecarSession> CreateSessionAsync(
        string  sessionId,
        int     width      = 1280,
        int     height     = 720,
        string? initialUrl = null,
        CancellationToken ct = default)
    {
        if (_sessions.ContainsKey(sessionId))
            throw new InvalidOperationException($"Session '{sessionId}' already exists.");

        var client = new SidecarClient(sessionId);

        try
        {
            await client.ConnectAsync(SidecarBaseUrl, width, height, initialUrl, ct);
        }
        catch
        {
            await client.DisposeAsync();
            throw;
        }

        var session = new SidecarSession(sessionId, width, height, client);
        _sessions[sessionId] = session;
        return session;
    }

    public SidecarSession? GetSession(string sessionId)
    {
        _sessions.TryGetValue(sessionId, out var s);
        return s;
    }

    public async Task TerminateSessionAsync(string sessionId)
    {
        if (_sessions.TryRemove(sessionId, out var session))
            await session.DisposeAsync();
    }

    // ── Disposal ──────────────────────────────────────────────────────────────

    public async ValueTask DisposeAsync()
    {
        foreach (var session in _sessions.Values)
        {
            try { await session.DisposeAsync(); } catch { /* best-effort */ }
        }
        _sessions.Clear();
    }
}
