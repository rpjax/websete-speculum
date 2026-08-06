using Speculum.Api.Sessions.Aggregates;
using Speculum.Api.Sessions.Requests;
using Speculum.Api.Sessions.Responses;

namespace Speculum.Api.Sessions.Services.Contracts;

public interface ISessionRepository
{
    Task<Session?> LoadAsync(Guid sessionId, CancellationToken ct = default);
    Task SaveAsync(Session session, CancellationToken ct = default);

    /// <summary>
    /// Id of a Live session for <paramref name="profileId"/>, or null when none.
    /// </summary>
    Task<Guid?> TryGetLiveSessionIdByProfileAsync(Guid profileId, CancellationToken ct = default);

    /// <summary>Distinct profile ids that currently have at least one Live session row.</summary>
    Task<IReadOnlySet<Guid>> ListLiveProfileIdsAsync(CancellationToken ct = default);

    /// <summary>Deletes non-Live session rows for a profile (orphan cleanup before profile purge).</summary>
    Task<int> DeleteNonLiveByProfileAsync(Guid profileId, CancellationToken ct = default);

    /// <summary>Paged, filtered listing over durable session rows (live + historical).</summary>
    Task<(IReadOnlyList<SessionListItem> Items, int Total)> ListAsync(
        ListSessions query,
        CancellationToken ct = default);

    /// <summary>
    /// Ids of ended (Stopped/Aborted) sessions, oldest EndedAt first — used to feed the
    /// Maintenance choke point's bulk-delete-ended-sessions action.
    /// </summary>
    Task<IReadOnlyList<Guid>> ListEndedSessionIdsAsync(
        DateTimeOffset? endedBefore,
        int take,
        CancellationToken ct = default);

    /// <summary>
    /// Hard-deletes a single durable session row. Journal facts are NOT touched here —
    /// only <c>IMaintenanceService</c> may pair this with a Journal cascade delete.
    /// </summary>
    Task<bool> DeleteAsync(Guid sessionId, CancellationToken ct = default);
}
