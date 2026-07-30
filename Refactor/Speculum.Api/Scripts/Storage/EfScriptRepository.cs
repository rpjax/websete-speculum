using Microsoft.EntityFrameworkCore;
using Speculum.Api.Database;
using Speculum.Api.Scripts.Responses;
using Speculum.Api.Scripts.Services.Contracts;

namespace Speculum.Api.Scripts.Storage;

public sealed class EfScriptRepository : IScriptRepository
{
    private readonly SpeculumDbContext _db;

    public EfScriptRepository(SpeculumDbContext db)
    {
        _db = db ?? throw new ArgumentNullException(nameof(db));
    }

    public async Task<bool> ExistsAsync(Guid scriptId, CancellationToken ct = default)
        => await _db.Scripts
            .AsNoTracking()
            .AnyAsync(s => s.Id == scriptId, ct)
            .ConfigureAwait(false);

    public async Task<ScriptRecord?> LoadAsync(Guid scriptId, CancellationToken ct = default)
        => await _db.Scripts
            .AsNoTracking()
            .FirstOrDefaultAsync(s => s.Id == scriptId, ct)
            .ConfigureAwait(false);

    public async Task SaveAsync(ScriptRecord script, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(script);

        var existing = await _db.Scripts
            .FirstOrDefaultAsync(s => s.Id == script.Id, ct)
            .ConfigureAwait(false);

        if (existing is null)
        {
            _db.Scripts.Add(script);
        }
        else
        {
            existing.Name = script.Name;
            existing.Content = script.Content;
            existing.Sha256 = script.Sha256;
            existing.SizeBytes = script.SizeBytes;
            existing.UpdatedAtUtc = script.UpdatedAtUtc;
        }

        await _db.SaveChangesAsync(ct).ConfigureAwait(false);
    }

    public async Task<(IReadOnlyList<ScriptListItem> Items, int Total)> ListAsync(
        string query,
        int skip,
        int take,
        CancellationToken ct = default)
    {
        var normalized = query.Trim();
        var rows = _db.Scripts.AsNoTracking();
        if (!string.IsNullOrWhiteSpace(normalized))
        {
            rows = rows.Where(s =>
                s.Name.Contains(normalized)
                || s.Content.Contains(normalized)
                || s.Sha256.Contains(normalized)
                || s.Id.ToString().Contains(normalized));
        }

        var total = await rows.CountAsync(ct).ConfigureAwait(false);
        var items = await rows
            .OrderByDescending(s => s.CreatedAtUtc)
            .ThenBy(s => s.Id)
            .Skip(skip)
            .Take(take)
            .Select(s => new ScriptListItem
            {
                Id = s.Id,
                Name = s.Name,
                Sha256 = s.Sha256,
                Size = s.SizeBytes,
                UploadedAt = s.CreatedAtUtc,
                UpdatedAt = s.UpdatedAtUtc,
            })
            .ToListAsync(ct)
            .ConfigureAwait(false);

        return (items, total);
    }

    public async Task<bool> DeleteAsync(Guid scriptId, CancellationToken ct = default)
    {
        var deleted = await _db.Scripts
            .Where(s => s.Id == scriptId)
            .ExecuteDeleteAsync(ct)
            .ConfigureAwait(false);
        return deleted > 0;
    }
}
