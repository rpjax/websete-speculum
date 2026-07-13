using System.Collections.Concurrent;
using System.Diagnostics.CodeAnalysis;
using Speculum.Api.BrowserPersistence;

namespace Speculum.Api.Motor.Live;

public sealed class MotorSessionRegistry : IMotorSessionRegistry
{
    private readonly ConcurrentDictionary<string, IMotorSession> _sessions = new();
    private readonly ConcurrentDictionary<string, IMotorSession> _starting = new();
    private int _activeSlots;

    public void Register(string connectionId, IMotorSession session)
        => _sessions[connectionId] = session;

    public IMotorSession? Get(string connectionId)
        => _sessions.GetValueOrDefault(connectionId);

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
        => _starting[connectionId] = session;

    public bool TryPromoteStarting(string connectionId, IMotorSession session)
    {
        if (!_starting.TryRemove(connectionId, out var tracked) || tracked != session)
            return false;

        _sessions[connectionId] = session;
        return true;
    }

    public bool TryCancelStarting(string connectionId, [NotNullWhen(true)] out IMotorSession? session)
        => _starting.TryRemove(connectionId, out session);

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

            if (!string.IsNullOrWhiteSpace(session.PersistedSessionId))
            {
                try { await session.CaptureAndPersistAsync(session.PersistedSessionId!, store, ct); }
                catch { /* best-effort */ }
            }

            try { await session.StopAsync(ct); }
            catch { /* best-effort */ }
        }

        if (Volatile.Read(ref _activeSlots) < 0)
            Interlocked.Exchange(ref _activeSlots, 0);
    }
}
