using Microsoft.EntityFrameworkCore;
using Speculum.Api.Database;
using Speculum.Api.Profiles.Aggregates;
using Speculum.Api.Profiles.Services.Contracts;

namespace Speculum.Api.Profiles.Storage;

public sealed class EfProfileRepository : IProfileRepository
{
    private readonly SpeculumDbContext _db;

    public EfProfileRepository(SpeculumDbContext db)
    {
        _db = db ?? throw new ArgumentNullException(nameof(db));
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

        var record = ProfileMapper.ToRecord(profile);
        var existing = await _db.Profiles
            .FirstOrDefaultAsync(p => p.Id == profile.Id, ct)
            .ConfigureAwait(false);

        if (existing is null)
        {
            _db.Profiles.Add(record);
        }
        else
        {
            existing.StateJson = record.StateJson;
        }

        await _db.SaveChangesAsync(ct).ConfigureAwait(false);
    }
}
