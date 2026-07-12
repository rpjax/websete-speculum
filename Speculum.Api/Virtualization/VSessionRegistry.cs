using System.Collections.Concurrent;
using System.Diagnostics.CodeAnalysis;
using Speculum.Api.Virtualization.Contracts;
using Speculum.Api.Virtualization.Persistence;

namespace Speculum.Api.Virtualization;

public sealed class VSessionRegistry : IVSessionRegistry
{
    private readonly ConcurrentDictionary<string, VSession> _sessions  = new();
    private readonly ConcurrentDictionary<string, VSession> _starting  = new();
    private int _activeSlots;

    public void Register(string connectionId, VSession session)
        => _sessions[connectionId] = session;

    public VSession? Get(string connectionId)
        => _sessions.GetValueOrDefault(connectionId);

    public bool TryRemove(string connectionId, [NotNullWhen(true)] out VSession? session)
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

    public void TrackStarting(string connectionId, VSession session)
        => _starting[connectionId] = session;

    public bool TryPromoteStarting(string connectionId, VSession session)
    {
        if (!_starting.TryRemove(connectionId, out var tracked) || tracked != session)
            return false;

        _sessions[connectionId] = session;
        return true;
    }

    public bool TryCancelStarting(string connectionId, [NotNullWhen(true)] out VSession? session)
        => _starting.TryRemove(connectionId, out session);

    public async Task StopAllAsync(IProfileSnapshotMerger merger, CancellationToken ct = default)
    {
        var connectionIds = _sessions.Keys
            .Concat(_starting.Keys)
            .Distinct()
            .ToArray();

        foreach (var connectionId in connectionIds)
        {
            VSession? session = null;
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
                try { await session.CaptureAndPersistAsync(session.PersistedSessionId!, merger, ct); }
                catch { /* best-effort */ }
            }

            try { await session.StopAsync(ct); }
            catch { /* best-effort */ }
        }

        if (Volatile.Read(ref _activeSlots) < 0)
            Interlocked.Exchange(ref _activeSlots, 0);
    }
}
