using System.Diagnostics.CodeAnalysis;
using Speculum.Api.BrowserPersistence;
using Speculum.Api.Motor.Diagnostics;

namespace Speculum.Api.Motor.Live;

/// <summary>
/// Registo singleton de sessões motor ativas, indexadas por
/// <c>ConnectionId</c> do SignalR.
/// </summary>
public interface IMotorSessionRegistry
{
    /// <summary>Associa (ou substitui) uma sessão ao ID de conexão dado.</summary>
    void Register(string connectionId, IMotorSession session);

    /// <summary>Devolve a sessão associada (activa ou starting) ou <c>null</c>.</summary>
    IMotorSession? Get(string connectionId);

    /// <summary>
    /// Remove e devolve a sessão associada.
    /// Devolve <c>true</c> se existia uma sessão registada.
    /// </summary>
    bool TryRemove(string connectionId, [NotNullWhen(true)] out IMotorSession? session);

    /// <summary>Number of active motor sessions.</summary>
    int ActiveCount { get; }

    /// <summary>Number of sessions still starting.</summary>
    int StartingCount { get; }

    /// <summary>
    /// Atomically reserves a session slot when under <paramref name="max"/>.
    /// Returns false when the limit is already reached.
    /// </summary>
    bool TryAcquireSlot(int max);

    /// <summary>Releases a slot reserved by <see cref="TryAcquireSlot"/> when start fails.</summary>
    void ReleaseSlot();

    /// <summary>Tracks a session still starting (not yet registered).</summary>
    void TrackStarting(string connectionId, IMotorSession session);

    /// <summary>
    /// Moves a starting session into the active registry.
    /// Returns false if the connection was cancelled during startup.
    /// </summary>
    bool TryPromoteStarting(string connectionId, IMotorSession session);

    /// <summary>Removes and returns a session that was still starting.</summary>
    bool TryCancelStarting(string connectionId, [NotNullWhen(true)] out IMotorSession? session);

    IReadOnlyList<MotorSessionListItem> ListSessions();

    /// <summary>
    /// Full per-session diagnostics snapshots for active + starting sessions, in a single
    /// in-memory pass. Shared by the Telemetry motor + sidecar sources so a sample tick
    /// iterates the registry once.
    /// </summary>
    IReadOnlyList<MotorSessionDiagnosticsSnapshot> ListSnapshots();

    bool TryFindByPersistedSessionId(
        string persistedSessionId,
        [NotNullWhen(true)] out IMotorSession? session,
        [NotNullWhen(true)] out string? connectionId);

    bool TryFindBySidecarSessionId(
        string sidecarSessionId,
        [NotNullWhen(true)] out IMotorSession? session,
        [NotNullWhen(true)] out string? connectionId);

    /// <summary>Captures browser state, stops and removes all active and starting sessions.</summary>
    /// <param name="correlationId">
    /// When set, per-session drain beats (StateExport*/SessionStopped/SlotReleased/SidecarDisconnected)
    /// are emitted through the Motor producer handle under this correlation (shared with
    /// DrainStarted/Completed). When <c>null</c> the drain is silent (e.g. graceful shutdown).
    /// </param>
    Task StopAllAsync(
        IBrowserSessionStore store,
        CancellationToken ct = default,
        string? correlationId = null);
}
