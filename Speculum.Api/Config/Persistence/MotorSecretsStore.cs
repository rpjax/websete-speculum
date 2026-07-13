using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace Speculum.Api.Config.Persistence;

internal static class MotorSecretsKeys
{
    public const string SectionKey = "_MotorSecrets";
}

public sealed class MotorSecretsStore
{
    private readonly string _databasePath;

    public MotorSecretsStore(string databasePath)
    {
        _databasePath = databasePath;
    }

    public async Task<byte[]> GetOrCreateNavigationStateKeyAsync(CancellationToken ct = default)
    {
        await using var db = CreateContext();
        var existing = await db.ConfigSections.AsNoTracking()
            .Where(e => e.Key == MotorSecretsKeys.SectionKey)
            .Select(e => e.ValueJson)
            .FirstOrDefaultAsync(ct);

        if (existing is not null)
        {
            var parsed = TryParseKey(existing);
            if (parsed is not null)
                return parsed;
        }

        var key = new byte[32];
        RandomNumberGenerator.Fill(key);
        var json = JsonSerializer.Serialize(new
        {
            navigationStateKey = Convert.ToBase64String(key),
        });
        var updatedAt = DateTimeOffset.UtcNow.ToString("O");

        await db.Database.ExecuteSqlRawAsync(
            """
            INSERT INTO config_sections (key, value_json, updated_at)
            VALUES ({0}, {1}, {2})
            ON CONFLICT(key) DO NOTHING
            """,
            [MotorSecretsKeys.SectionKey, json, updatedAt],
            ct);

        var persisted = await db.ConfigSections.AsNoTracking()
            .Where(e => e.Key == MotorSecretsKeys.SectionKey)
            .Select(e => e.ValueJson)
            .FirstOrDefaultAsync(ct);

        return TryParseKey(persisted!) ?? key;
    }

    private static byte[]? TryParseKey(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.TryGetProperty("navigationStateKey", out var keyEl)
                && keyEl.ValueKind == JsonValueKind.String)
            {
                var b64 = keyEl.GetString();
                if (!string.IsNullOrEmpty(b64))
                    return Convert.FromBase64String(b64);
            }
        }
        catch { /* caller regenerates */ }

        return null;
    }

    private SpeculumDbContext CreateContext()
    {
        var dir = Path.GetDirectoryName(_databasePath);
        if (!string.IsNullOrEmpty(dir))
            Directory.CreateDirectory(dir);
        return new SpeculumDbContext(_databasePath);
    }
}
