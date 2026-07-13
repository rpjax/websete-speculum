using Microsoft.EntityFrameworkCore;
using Speculum.Api.Config.Persistence;

namespace Speculum.Api.Config.Persistence;

public sealed class ConfigSectionRepository
{
    public string DatabasePath { get; }

    public ConfigSectionRepository(string databasePath)
    {
        DatabasePath = databasePath;
    }

    public async Task EnsureSchemaAsync(CancellationToken ct = default)
    {
        await using var db = CreateContext();
        await db.Database.ExecuteSqlRawAsync(
            """
            CREATE TABLE IF NOT EXISTS config_sections (
                key TEXT NOT NULL PRIMARY KEY,
                value_json TEXT NULL,
                updated_at TEXT NOT NULL
            );
            """, ct);
    }

    public async Task<IReadOnlyList<ConfigSectionEntity>> GetAllAsync(CancellationToken ct = default)
    {
        await using var db = CreateContext();
        return await db.ConfigSections.AsNoTracking().ToListAsync(ct);
    }

    public async Task<ConfigSectionEntity?> FindAsync(string key, CancellationToken ct = default)
    {
        await using var db = CreateContext();
        return await db.ConfigSections.FindAsync([key], ct);
    }

    public async Task<string?> GetRawValueAsync(string key, CancellationToken ct = default)
    {
        await using var db = CreateContext();
        var entity = await db.ConfigSections.AsNoTracking().FirstOrDefaultAsync(e => e.Key == key, ct);
        return entity?.ValueJson;
    }

    public async Task<bool> ExistsAsync(string key, CancellationToken ct = default)
    {
        await using var db = CreateContext();
        return await db.ConfigSections.AsNoTracking().AnyAsync(e => e.Key == key, ct);
    }

    public async Task UpsertAsync(string key, string valueJson, CancellationToken ct = default)
    {
        await using var db = CreateContext();
        var updatedAt = DateTimeOffset.UtcNow.ToString("O");
        await db.Database.ExecuteSqlRawAsync(
            """
            INSERT INTO config_sections (key, value_json, updated_at)
            VALUES ({0}, {1}, {2})
            ON CONFLICT(key) DO UPDATE SET
                value_json = excluded.value_json,
                updated_at = excluded.updated_at
            """,
            [key, valueJson, updatedAt],
            ct);
    }

    public async Task ClearValueAsync(string key, CancellationToken ct = default)
    {
        await using var db = CreateContext();
        var entity = await db.ConfigSections.FindAsync([key], ct);
        if (entity is null)
            return;

        entity.ValueJson = null;
        entity.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
    }

    public async Task<int> EnsureAdminSeedAsync(string key, string valueJson, CancellationToken ct = default)
    {
        await using var db = CreateContext();
        var updatedAt = DateTimeOffset.UtcNow.ToString("O");
        return await db.Database.ExecuteSqlRawAsync(
            """
            INSERT OR IGNORE INTO config_sections (key, value_json, updated_at)
            VALUES ({0}, {1}, {2})
            """,
            [key, valueJson, updatedAt],
            ct);
    }

    private SpeculumDbContext CreateContext() => new(DatabasePath);
}
