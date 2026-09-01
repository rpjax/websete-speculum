using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Speculum.Api.Configurations.Persistence;
using Speculum.Api.Database;

namespace Speculum.Api.Configurations.Persistence;

public sealed class ConfigSectionStore : IConfigSectionStore
{
    private static readonly JsonSerializerOptionsHolder JsonHolder = new();

    private readonly IServiceScopeFactory _scopeFactory;

    public ConfigSectionStore(IServiceScopeFactory scopeFactory)
    {
        _scopeFactory = scopeFactory;
    }

    public static System.Text.Json.JsonSerializerOptions SerializerOptions => JsonHolder.Options;

    public async Task EnsureSchemaAsync(CancellationToken ct = default)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<SpeculumDbContext>();

        await db.Database.ExecuteSqlRawAsync(
            """
            CREATE TABLE IF NOT EXISTS config_sections (
              Key TEXT NOT NULL CONSTRAINT PK_config_sections PRIMARY KEY,
              ValueJson TEXT NULL,
              UpdatedAt TEXT NOT NULL
            );
            """,
            ct).ConfigureAwait(false);

        await db.Database.ExecuteSqlRawAsync(
            """
            CREATE TABLE IF NOT EXISTS motor_metadata (
              Key TEXT NOT NULL CONSTRAINT PK_motor_metadata PRIMARY KEY,
              Value TEXT NULL,
              UpdatedAt TEXT NOT NULL
            );
            """,
            ct).ConfigureAwait(false);

        var exists = await db.Set<MotorMetadataRecord>()
            .AsNoTracking()
            .AnyAsync(m => m.Key == ConfigSectionKeys.MetadataIsFirstBoot, ct)
            .ConfigureAwait(false);

        if (!exists)
        {
            db.Set<MotorMetadataRecord>().Add(new MotorMetadataRecord
            {
                Key = ConfigSectionKeys.MetadataIsFirstBoot,
                Value = "true",
                UpdatedAt = DateTimeOffset.UtcNow,
            });
            await db.SaveChangesAsync(ct).ConfigureAwait(false);
        }

        await MigrateLegacySectionKeysAsync(db, ct).ConfigureAwait(false);
    }

    private static async Task MigrateLegacySectionKeysAsync(SpeculumDbContext db, CancellationToken ct)
    {
        foreach (var (legacy, canonical) in ConfigSectionKeys.LegacyKeyMigrations)
        {
            var oldRow = await db.Set<ConfigSectionRecord>()
                .FirstOrDefaultAsync(s => s.Key == legacy, ct)
                .ConfigureAwait(false);
            if (oldRow is null)
                continue;

            var newRow = await db.Set<ConfigSectionRecord>()
                .FirstOrDefaultAsync(s => s.Key == canonical, ct)
                .ConfigureAwait(false);
            if (newRow is null)
            {
                db.Set<ConfigSectionRecord>().Add(new ConfigSectionRecord
                {
                    Key = canonical,
                    ValueJson = oldRow.ValueJson,
                    UpdatedAt = DateTimeOffset.UtcNow,
                });
                db.Set<ConfigSectionRecord>().Remove(oldRow);
            }
            else if (string.IsNullOrWhiteSpace(newRow.ValueJson)
                && !string.IsNullOrWhiteSpace(oldRow.ValueJson))
            {
                newRow.ValueJson = oldRow.ValueJson;
                newRow.UpdatedAt = DateTimeOffset.UtcNow;
                db.Set<ConfigSectionRecord>().Remove(oldRow);
            }
            else
            {
                db.Set<ConfigSectionRecord>().Remove(oldRow);
            }
        }

        await db.SaveChangesAsync(ct).ConfigureAwait(false);
    }

    public async Task<bool> GetIsFirstBootAsync(CancellationToken ct = default)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<SpeculumDbContext>();
        var row = await db.Set<MotorMetadataRecord>()
            .AsNoTracking()
            .FirstOrDefaultAsync(m => m.Key == ConfigSectionKeys.MetadataIsFirstBoot, ct)
            .ConfigureAwait(false);

        if (row is null || string.IsNullOrWhiteSpace(row.Value))
            return true;

        return string.Equals(row.Value, "true", StringComparison.OrdinalIgnoreCase)
            || string.Equals(row.Value, "1", StringComparison.OrdinalIgnoreCase);
    }

    public async Task SetIsFirstBootAsync(bool value, CancellationToken ct = default)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<SpeculumDbContext>();
        var row = await db.Set<MotorMetadataRecord>()
            .FirstOrDefaultAsync(m => m.Key == ConfigSectionKeys.MetadataIsFirstBoot, ct)
            .ConfigureAwait(false);

        if (row is null)
        {
            db.Set<MotorMetadataRecord>().Add(new MotorMetadataRecord
            {
                Key = ConfigSectionKeys.MetadataIsFirstBoot,
                Value = value ? "true" : "false",
                UpdatedAt = DateTimeOffset.UtcNow,
            });
        }
        else
        {
            row.Value = value ? "true" : "false";
            row.UpdatedAt = DateTimeOffset.UtcNow;
        }

        await db.SaveChangesAsync(ct).ConfigureAwait(false);
    }

    public async Task<string?> GetSectionJsonAsync(string key, CancellationToken ct = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(key);
        await using var scope = _scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<SpeculumDbContext>();
        var row = await db.Set<ConfigSectionRecord>()
            .AsNoTracking()
            .FirstOrDefaultAsync(s => s.Key == key, ct)
            .ConfigureAwait(false);
        return row?.ValueJson;
    }

    public async Task UpsertSectionJsonAsync(string key, string? valueJson, CancellationToken ct = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(key);
        await using var scope = _scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<SpeculumDbContext>();
        var row = await db.Set<ConfigSectionRecord>()
            .FirstOrDefaultAsync(s => s.Key == key, ct)
            .ConfigureAwait(false);

        if (row is null)
        {
            db.Set<ConfigSectionRecord>().Add(new ConfigSectionRecord
            {
                Key = key,
                ValueJson = valueJson,
                UpdatedAt = DateTimeOffset.UtcNow,
            });
        }
        else
        {
            row.ValueJson = valueJson;
            row.UpdatedAt = DateTimeOffset.UtcNow;
        }

        await db.SaveChangesAsync(ct).ConfigureAwait(false);
    }

    public async Task<IReadOnlyDictionary<string, string?>> GetAllSectionJsonAsync(
        CancellationToken ct = default)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<SpeculumDbContext>();
        var rows = await db.Set<ConfigSectionRecord>()
            .AsNoTracking()
            .ToListAsync(ct)
            .ConfigureAwait(false);

        return rows.ToDictionary(r => r.Key, r => r.ValueJson, StringComparer.OrdinalIgnoreCase);
    }

    private sealed class JsonSerializerOptionsHolder
    {
        public System.Text.Json.JsonSerializerOptions Options { get; } = Create();

        private static System.Text.Json.JsonSerializerOptions Create()
        {
            var options = new System.Text.Json.JsonSerializerOptions
            {
                PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase,
                PropertyNameCaseInsensitive = true,
                WriteIndented = false,
            };
            options.Converters.Add(
                new System.Text.Json.Serialization.JsonStringEnumConverter(
                    System.Text.Json.JsonNamingPolicy.CamelCase,
                    allowIntegerValues: true));
            return options;
        }
    }
}
