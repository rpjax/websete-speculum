using Speculum.Api.Sessions.Aggregates;

namespace Speculum.Api.Sessions.Services.Contracts;

public interface ISessionRepository
{
    Task<Session?> LoadAsync(Guid sessionId, CancellationToken ct = default);
    Task SaveAsync(Session session, CancellationToken ct = default);

    /// <summary>
    /// True when any session row for <paramref name="profileId"/> is still Live.
    /// </summary>
    Task<bool> AnyLiveByProfileAsync(Guid profileId, CancellationToken ct = default);
}
