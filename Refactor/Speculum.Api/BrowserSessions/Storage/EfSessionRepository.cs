using Microsoft.EntityFrameworkCore;
using Speculum.Api.BrowserSessions.Aggregates;
using Speculum.Api.BrowserSessions.Services.Contracts;
using Speculum.Api.Database;

namespace Speculum.Api.BrowserSessions.Storage;

public sealed class EfSessionRepository : ISessionRepository
{
    private readonly SpeculumDbContext _db;

    public EfSessionRepository(SpeculumDbContext db)
    {
        _db = db ?? throw new ArgumentNullException(nameof(db));
    }

    public async Task<Session?> LoadAsync(Guid sessionId, CancellationToken ct = default)
    {
        var record = await _db.Sessions
            .AsNoTracking()
            .FirstOrDefaultAsync(s => s.Id == sessionId, ct)
            .ConfigureAwait(false);

        return record is null ? null : SessionMapper.ToDomain(record);
    }

    public async Task SaveAsync(Session session, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(session);

        var record = SessionMapper.ToRecord(session);
        var existing = await _db.Sessions
            .FirstOrDefaultAsync(s => s.Id == session.Id, ct)
            .ConfigureAwait(false);

        if (existing is null)
        {
            _db.Sessions.Add(record);
        }
        else
        {
            existing.ProfileId = record.ProfileId;
            existing.State = record.State;
        }

        await _db.SaveChangesAsync(ct).ConfigureAwait(false);
    }
}
