using Microsoft.EntityFrameworkCore;
using Speculum.Api.Database;
using Speculum.Api.Sessions.Aggregates;
using Speculum.Api.Sessions.Models;
using Speculum.Api.Sessions.Requests;
using Speculum.Api.Sessions.Responses;
using Speculum.Api.Sessions.Services.Contracts;

namespace Speculum.Api.Sessions.Storage;

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
            existing.CreatedAt = record.CreatedAt;
            existing.StoppedAt = record.StoppedAt;
            existing.AbortedAt = record.AbortedAt;
            existing.StopReason = record.StopReason;
            existing.MirrorMode = record.MirrorMode;
            existing.ViewportWidth = record.ViewportWidth;
            existing.ViewportHeight = record.ViewportHeight;
        }

        await _db.SaveChangesAsync(ct).ConfigureAwait(false);
    }

    public async Task<Guid?> TryGetLiveSessionIdByProfileAsync(Guid profileId, CancellationToken ct = default)
        => await _db.Sessions
            .AsNoTracking()
            .Where(s => s.ProfileId == profileId && s.State == LifecycleState.Live)
            .Select(s => (Guid?)s.Id)
            .FirstOrDefaultAsync(ct)
            .ConfigureAwait(false);

    public async Task<IReadOnlySet<Guid>> ListLiveProfileIdsAsync(CancellationToken ct = default)
    {
        var ids = await _db.Sessions
            .AsNoTracking()
            .Where(s => s.State == LifecycleState.Live)
            .Select(s => s.ProfileId)
            .Distinct()
            .ToListAsync(ct)
            .ConfigureAwait(false);
        return ids.ToHashSet();
    }

    public async Task<IReadOnlyList<Guid>> ListLiveSessionIdsAsync(CancellationToken ct = default)
        => await _db.Sessions
            .AsNoTracking()
            .Where(s => s.State == LifecycleState.Live)
            .Select(s => s.Id)
            .ToListAsync(ct)
            .ConfigureAwait(false);

    public async Task<int> DeleteNonLiveByProfileAsync(Guid profileId, CancellationToken ct = default)
        => await _db.Sessions
            .Where(s => s.ProfileId == profileId && s.State != LifecycleState.Live)
            .ExecuteDeleteAsync(ct)
            .ConfigureAwait(false);

    public async Task<(IReadOnlyList<SessionListItem> Items, int Total)> ListAsync(
        ListSessions query,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(query);

        IQueryable<SessionRecord> filtered = _db.Sessions.AsNoTracking();

        if (query.SessionId is { } sessionId)
            filtered = filtered.Where(s => s.Id == sessionId);

        if (query.ProfileId is { } profileId)
            filtered = filtered.Where(s => s.ProfileId == profileId);

        if (query.State is { } state)
            filtered = filtered.Where(s => s.State == state);

        if (query.MirrorMode is { } mirrorMode)
            filtered = filtered.Where(s => s.MirrorMode == mirrorMode);

        var total = await filtered.CountAsync(ct).ConfigureAwait(false);

        var ordered = query.SortDescending
            ? filtered.OrderByDescending(s => s.CreatedAt)
            : filtered.OrderBy(s => s.CreatedAt);

        var take = Math.Clamp(query.Take <= 0 ? ListSessions.DefaultTake : query.Take, 1, ListSessions.MaxTake);
        var skip = Math.Max(0, query.Skip);

        var records = await ordered
            .Skip(skip)
            .Take(take)
            .ToListAsync(ct)
            .ConfigureAwait(false);

        var items = records.Select(ToListItem).ToArray();
        return (items, total);
    }

    public async Task<IReadOnlyList<Guid>> ListEndedSessionIdsAsync(
        DateTimeOffset? endedBefore,
        int take,
        CancellationToken ct = default)
    {
        IQueryable<SessionRecord> ended = _db.Sessions
            .AsNoTracking()
            .Where(s => s.State == LifecycleState.Stopped || s.State == LifecycleState.Aborted);

        if (endedBefore is { } cutoff)
        {
            ended = ended.Where(s =>
                (s.StoppedAt ?? s.AbortedAt) != null
                && (s.StoppedAt ?? s.AbortedAt) < cutoff);
        }

        return await ended
            .OrderBy(s => s.StoppedAt ?? s.AbortedAt)
            .Take(Math.Max(1, take))
            .Select(s => s.Id)
            .ToListAsync(ct)
            .ConfigureAwait(false);
    }

    public async Task<bool> DeleteAsync(Guid sessionId, CancellationToken ct = default)
        => await _db.Sessions
            .Where(s => s.Id == sessionId)
            .ExecuteDeleteAsync(ct)
            .ConfigureAwait(false) > 0;

    private static SessionListItem ToListItem(SessionRecord record)
        => new()
        {
            SessionId = record.Id,
            ProfileId = record.ProfileId,
            State = record.State,
            StartedAt = record.CreatedAt,
            EndedAt = record.StoppedAt ?? record.AbortedAt,
            EndReason = record.StopReason?.ToStableString(),
            MirrorMode = record.MirrorMode,
            ViewportWidth = record.ViewportWidth,
            ViewportHeight = record.ViewportHeight,
        };
}
