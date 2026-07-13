using System.Collections.Concurrent;
using System.Diagnostics.CodeAnalysis;
using Speculum.Api.BrowserPersistence;
using Speculum.Api.Diagnostics.Abstractions;

namespace Speculum.Api.Motor.Live;

public sealed class MotorSessionRegistry : IMotorSessionRegistry
{
    private readonly ConcurrentDictionary<string, IMotorSession> _sessions = new();
    private readonly ConcurrentDictionary<string, IMotorSession> _starting = new();
    private int _activeSlots;

    public void Register(string connectionId, IMotorSession session)
    {
        session.ConnectionId = connectionId;
        _sessions[connectionId] = session;
    }

    public IMotorSession? Get(string connectionId)
    {
        if (_sessions.TryGetValue(connectionId, out var active))
            return active;
        if (_starting.TryGetValue(connectionId, out var starting))
            return starting;
        return null;
    }

    public bool TryRemove(string connectionId, [NotNullWhen(true)] out IMotorSession? session)
    {
        if (_sessions.TryRemove(connectionId, out session))
        {
            Interlocked.Decrement(ref _activeSlots);
            return true;
        }

        session = null;
        return false;
    }

    public int ActiveCount => Volatile.Read(ref _activeSlots);

    public int StartingCount => _starting.Count;

    public bool TryAcquireSlot(int max)
    {
        while (true)
        {
            var current = Volatile.Read(ref _activeSlots);
            if (current >= max) return false;
            if (Interlocked.CompareExchange(ref _activeSlots, current + 1, current) == current)
                return true;
        }
    }

    public void ReleaseSlot()
    {
        Interlocked.Decrement(ref _activeSlots);
        if (Volatile.Read(ref _activeSlots) < 0)
            Interlocked.Exchange(ref _activeSlots, 0);
    }

    public void TrackStarting(string connectionId, IMotorSession session)
    {
        session.ConnectionId = connectionId;
        session.MarkPhase(MotorSessionPhase.Starting);
        _starting[connectionId] = session;
    }

    public bool TryPromoteStarting(string connectionId, IMotorSession session)
    {
        if (!_starting.TryRemove(connectionId, out var tracked) || tracked != session)
            return false;

        session.MarkPhase(MotorSessionPhase.Running);
        _sessions[connectionId] = session;
        return true;
    }

    public bool TryCancelStarting(string connectionId, [NotNullWhen(true)] out IMotorSession? session)
        => _starting.TryRemove(connectionId, out session);

    public IReadOnlyList<MotorSessionListItem> ListSessions()
    {
        var items = new List<MotorSessionListItem>();
        foreach (var (cid, session) in _sessions)
        {
            var snap = session.GetDiagnosticsSnapshot();
            items.Add(new MotorSessionListItem
            {
                ConnectionId = cid,
                PersistedSessionId = snap.PersistedSessionId,
                SidecarSessionId = snap.SidecarSessionId,
                Phase = snap.Phase,
                CurrentUrl = snap.CurrentUrl,
                Starting = false,
            });
        }

        foreach (var (cid, session) in _starting)
        {
            var snap = session.GetDiagnosticsSnapshot();
            items.Add(new MotorSessionListItem
            {
                ConnectionId = cid,
                PersistedSessionId = snap.PersistedSessionId,
                SidecarSessionId = snap.SidecarSessionId,
                Phase = snap.Phase,
                CurrentUrl = snap.CurrentUrl,
                Starting = true,
            });
        }

        return items;
    }

    public bool TryFindByPersistedSessionId(
        string persistedSessionId,
        [NotNullWhen(true)] out IMotorSession? session,
        [NotNullWhen(true)] out string? connectionId)
    {
        foreach (var (cid, s) in _sessions.Concat(_starting))
        {
            if (string.Equals(s.PersistedSessionId, persistedSessionId, StringComparison.Ordinal))
            {
                session = s;
                connectionId = cid;
                return true;
            }
        }

        session = null;
        connectionId = null;
        return false;
    }

    public bool TryFindBySidecarSessionId(
        string sidecarSessionId,
        [NotNullWhen(true)] out IMotorSession? session,
        [NotNullWhen(true)] out string? connectionId)
    {
        foreach (var (cid, s) in _sessions.Concat(_starting))
        {
            if (string.Equals(s.SidecarSessionId, sidecarSessionId, StringComparison.Ordinal))
            {
                session = s;
                connectionId = cid;
                return true;
            }
        }

        session = null;
        connectionId = null;
        return false;
    }

    public async Task StopAllAsync(IBrowserSessionStore store, CancellationToken ct = default)
    {
        var connectionIds = _sessions.Keys
            .Concat(_starting.Keys)
            .Distinct()
            .ToArray();

        foreach (var connectionId in connectionIds)
        {
            IMotorSession? session = null;
            var removedActive = TryRemove(connectionId, out session);
            if (!removedActive)
            {
                if (!TryCancelStarting(connectionId, out session))
                    continue;

                ReleaseSlot();
            }

            if (session is null) continue;

            session.MarkPhase(MotorSessionPhase.Stopping);

            if (!string.IsNullOrWhiteSpace(session.PersistedSessionId))
            {
                try { await session.CaptureAndPersistAsync(session.PersistedSessionId!, store, ct); }
                catch { /* best-effort */ }
            }

            try { await session.StopAsync(ct); }
            catch { /* best-effort */ }

            session.MarkPhase(MotorSessionPhase.Stopped);
        }

        if (Volatile.Read(ref _activeSlots) < 0)
            Interlocked.Exchange(ref _activeSlots, 0);
    }
}
