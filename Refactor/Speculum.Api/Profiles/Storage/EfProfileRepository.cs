using Microsoft.EntityFrameworkCore;
using Speculum.Api.Database;
using Speculum.Api.Profiles.Aggregates;
using Speculum.Api.Profiles.Responses;
using Speculum.Api.Profiles.Services.Contracts;
using Speculum.Api.Sessions.Models;

namespace Speculum.Api.Profiles.Storage;

public sealed class EfProfileRepository : IProfileRepository
{
    private readonly SpeculumDbContext _db;
    private readonly TimeProvider _time;

    public EfProfileRepository(SpeculumDbContext db, TimeProvider? time = null)
    {
        _db = db ?? throw new ArgumentNullException(nameof(db));
        _time = time ?? TimeProvider.System;
    }

    public async Task<bool> ExistsAsync(Guid profileId, CancellationToken ct = default)
        => await _db.Profiles
            .AsNoTracking()
            .AnyAsync(p => p.Id == profileId, ct)
            .ConfigureAwait(false);

    public async Task<Profile?> LoadAsync(Guid profileId, CancellationToken ct = default)
    {
        var record = await _db.Profiles
            .AsNoTracking()
            .FirstOrDefaultAsync(p => p.Id == profileId, ct)
            .ConfigureAwait(false);

        return record is null ? null : ProfileMapper.ToDomain(record);
    }

    public async Task SaveAsync(Profile profile, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(profile);

        var now = _time.GetUtcNow();
        var existing = await _db.Profiles
            .FirstOrDefaultAsync(p => p.Id == profile.Id, ct)
            .ConfigureAwait(false);

        if (existing is null)
        {
            _db.Profiles.Add(ProfileMapper.ToRecord(profile, now));
        }
        else
        {
            var updated = ProfileMapper.ToRecord(profile, now);
            existing.StateJson = updated.StateJson;
            existing.LastUsedAt = now;
        }

        await _db.SaveChangesAsync(ct).ConfigureAwait(false);
    }

    public async Task<bool> MergeSessionExportAsync(
        Guid profileId,
        SessionState export,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(export);

        await using var tx = await _db.Database.BeginTransactionAsync(ct).ConfigureAwait(false);

        var existing = await _db.Profiles
            .FirstOrDefaultAsync(p => p.Id == profileId, ct)
            .ConfigureAwait(false);
        if (existing is null)
        {
            await tx.RollbackAsync(ct).ConfigureAwait(false);
            return false;
        }

        var profile = ProfileMapper.ToDomain(existing);
        profile.ApplySessionExport(export);

        var now = _time.GetUtcNow();
        existing.StateJson = ProfileMapper.ToRecord(profile, now).StateJson;
        existing.LastUsedAt = now;

        await _db.SaveChangesAsync(ct).ConfigureAwait(false);
        await tx.CommitAsync(ct).ConfigureAwait(false);
        return true;
    }

    public async Task TouchLastUsedAsync(Guid profileId, CancellationToken ct = default)
    {
        var now = _time.GetUtcNow();
        await _db.Profiles
            .Where(p => p.Id == profileId)
            .ExecuteUpdateAsync(s => s.SetProperty(p => p.LastUsedAt, now), ct)
            .ConfigureAwait(false);
    }

    public async Task<IReadOnlyList<Guid>> ListExpiredInactiveAsync(
        DateTimeOffset olderThan,
        int take,
        IReadOnlySet<Guid> excludeLiveProfileIds,
        CancellationToken ct = default)
    {
        var query = _db.Profiles.AsNoTracking()
            .Where(p => p.LastUsedAt < olderThan);

        if (excludeLiveProfileIds.Count > 0)
        {
            var live = excludeLiveProfileIds.ToArray();
            query = query.Where(p => !live.Contains(p.Id));
        }

        return await query
            .OrderBy(p => p.LastUsedAt)
            .ThenBy(p => p.Id)
            .Select(p => p.Id)
            .Take(take)
            .ToListAsync(ct)
            .ConfigureAwait(false);
    }

    public async Task<ProfileSummary?> GetSummaryAsync(Guid profileId, CancellationToken ct = default)
    {
        var record = await _db.Profiles
            .AsNoTracking()
            .FirstOrDefaultAsync(p => p.Id == profileId, ct)
            .ConfigureAwait(false);

        return record is null ? null : ProfileMapper.ToSummary(record);
    }

    public async Task<(IReadOnlyList<ProfileListItem> Items, int Total)> ListAsync(
        int skip,
        int take,
        CancellationToken ct = default)
    {
        var query = _db.Profiles.AsNoTracking();
        var total = await query.CountAsync(ct).ConfigureAwait(false);
        var items = await query
            .OrderByDescending(p => p.CreatedAt)
            .ThenBy(p => p.Id)
            .Skip(skip)
            .Take(take)
            .Select(p => new ProfileListItem
            {
                ProfileId = p.Id,
                CreatedAt = p.CreatedAt,
                LastUsedAt = p.LastUsedAt,
            })
            .ToListAsync(ct)
            .ConfigureAwait(false);

        return (items, total);
    }

    public async Task<bool> DeleteAsync(Guid profileId, CancellationToken ct = default)
    {
        var deleted = await _db.Profiles
            .Where(p => p.Id == profileId)
            .ExecuteDeleteAsync(ct)
            .ConfigureAwait(false);

        return deleted > 0;
    }
}
