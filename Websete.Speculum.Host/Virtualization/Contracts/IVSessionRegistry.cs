using System.Diagnostics.CodeAnalysis;
using Websete.Speculum.Host.Virtualization.Persistence;

namespace Websete.Speculum.Host.Virtualization.Contracts;

/// <summary>
/// Registo singleton de sessões de virtualização ativas, indexadas por
/// <c>ConnectionId</c> do SignalR.
/// </summary>
public interface IVSessionRegistry
{
    /// <summary>Associa (ou substitui) uma sessão ao ID de conexão dado.</summary>
    void Register(string connectionId, VSession session);

    /// <summary>Devolve a sessão associada ou <c>null</c> se não existir.</summary>
    VSession? Get(string connectionId);

    /// <summary>
    /// Remove e devolve a sessão associada.
    /// Devolve <c>true</c> se existia uma sessão registada.
    /// </summary>
    bool TryRemove(string connectionId, [NotNullWhen(true)] out VSession? session);

    /// <summary>Number of active virtualization sessions.</summary>
    int ActiveCount { get; }

    /// <summary>
    /// Atomically reserves a session slot when under <paramref name="max"/>.
    /// Returns false when the limit is already reached.
    /// </summary>
    bool TryAcquireSlot(int max);

    /// <summary>Releases a slot reserved by <see cref="TryAcquireSlot"/> when start fails.</summary>
    void ReleaseSlot();

    /// <summary>Tracks a session still starting (not yet registered).</summary>
    void TrackStarting(string connectionId, VSession session);

    /// <summary>
    /// Moves a starting session into the active registry.
    /// Returns false if the connection was cancelled during startup.
    /// </summary>
    bool TryPromoteStarting(string connectionId, VSession session);

    /// <summary>Removes and returns a session that was still starting.</summary>
    bool TryCancelStarting(string connectionId, [NotNullWhen(true)] out VSession? session);

    /// <summary>Captures snapshots, stops and removes all active and starting sessions.</summary>
    Task StopAllAsync(IProfileSnapshotMerger merger, CancellationToken ct = default);
}
