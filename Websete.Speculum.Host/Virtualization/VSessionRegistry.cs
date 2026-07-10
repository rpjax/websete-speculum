using System.Collections.Concurrent;
using System.Diagnostics.CodeAnalysis;
using Websete.Speculum.Host.Virtualization.Contracts;

namespace Websete.Speculum.Host.Virtualization;

/// <inheritdoc cref="IVSessionRegistry"/>
public sealed class VSessionRegistry : IVSessionRegistry
{
    private readonly ConcurrentDictionary<string, VSession> _sessions = new();

    public void Register(string connectionId, VSession session)
        => _sessions[connectionId] = session;

    public VSession? Get(string connectionId)
        => _sessions.GetValueOrDefault(connectionId);

    public bool TryRemove(string connectionId, [NotNullWhen(true)] out VSession? session)
        => _sessions.TryRemove(connectionId, out session);

    public int ActiveCount => _sessions.Count;

    public async Task StopAllAsync(CancellationToken ct = default)
    {
        foreach (var connectionId in _sessions.Keys.ToArray())
        {
            if (!_sessions.TryRemove(connectionId, out var session))
                continue;

            try { await session.StopAsync(ct); }
            catch { /* best-effort */ }
        }
    }
}
