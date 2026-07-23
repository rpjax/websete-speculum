using Speculum.Api.Sessions.Aggregates;

namespace Speculum.Api.Sessions.Services.Contracts;

public interface ISessionRepository
{
    Task<Session?> LoadAsync(Guid sessionId, CancellationToken ct = default);
    Task SaveAsync(Session session, CancellationToken ct = default);
}
