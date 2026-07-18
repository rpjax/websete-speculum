using Speculum.Api.BrowserSessions.Aggregates;

namespace Speculum.Api.BrowserSessions.Services.Contracts;

public interface ISessionRepository
{
    Task<Session?> LoadAsync(Guid sessionId, CancellationToken ct = default);
    Task SaveAsync(Session session, CancellationToken ct = default);
}
