using Speculum.Api.Sessions.Aggregates;

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
}
