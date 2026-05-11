using System.Collections.Concurrent;
using Websete.Speculum.Host.WebRtc;

namespace Websete.Speculum.Host;

/// <summary>
/// Singleton that maps session IDs to their active <see cref="WebRtcSession"/>s
/// and tracks which SignalR connection ID owns each session.
///
/// This must be a singleton because SignalR hubs are transient — a new hub
/// instance is created for every method invocation, so the hub itself cannot
/// hold state across calls.
/// </summary>
public sealed class SessionRegistry
{
    private readonly ConcurrentDictionary<string, Entry> _map = new();

    private sealed record Entry(WebRtcSession Rtc, string ConnectionId);

    public void Register(string sessionId, string connectionId, WebRtcSession rtc)
        => _map[sessionId] = new Entry(rtc, connectionId);

    public WebRtcSession? Get(string sessionId)
        => _map.TryGetValue(sessionId, out var e) ? e.Rtc : null;

    /// <summary>
    /// Returns a snapshot of all session IDs owned by the given connection.
    /// ToList() is called immediately to avoid enumerating a mutating dictionary.
    /// </summary>
    public IReadOnlyList<string> GetByConnection(string connectionId)
        => _map
            .Where(kv => kv.Value.ConnectionId == connectionId)
            .Select(kv => kv.Key)
            .ToList();

    public bool TryRemove(string sessionId, out WebRtcSession? rtc)
    {
        if (_map.TryRemove(sessionId, out var e)) { rtc = e.Rtc; return true; }
        rtc = null;
        return false;
    }
}
