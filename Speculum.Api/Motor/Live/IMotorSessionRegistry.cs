using System.Diagnostics.CodeAnalysis;
using Speculum.Api.BrowserPersistence;
using Speculum.Api.Diagnostics.Abstractions;

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

    bool TryFindByPersistedSessionId(
        string persistedSessionId,
        [NotNullWhen(true)] out IMotorSession? session,
        [NotNullWhen(true)] out string? connectionId);

    bool TryFindBySidecarSessionId(
        string sidecarSessionId,
        [NotNullWhen(true)] out IMotorSession? session,
        [NotNullWhen(true)] out string? connectionId);

    /// <summary>Captures browser state, stops and removes all active and starting sessions.</summary>
    /// <param name="diagnostics">When set, emits per-session StateExport*/SessionStopped with reason drain.</param>
    /// <param name="correlationId">Correlation shared with DrainStarted/Completed when draining.</param>
    Task StopAllAsync(
        IBrowserSessionStore store,
        CancellationToken ct = default,
        IDiagnosticsEventBus? diagnostics = null,
        string? correlationId = null);
}
