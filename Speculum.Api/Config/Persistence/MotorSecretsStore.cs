using System.Security.Cryptography;
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
        var entity = await db.ConfigSections.FindAsync([MotorSecretsKeys.SectionKey], ct);

        if (entity?.ValueJson is not null)
        {
            try
            {
                using var doc = System.Text.Json.JsonDocument.Parse(entity.ValueJson);
                if (doc.RootElement.TryGetProperty("navigationStateKey", out var keyEl)
                    && keyEl.ValueKind == System.Text.Json.JsonValueKind.String)
                {
                    var b64 = keyEl.GetString();
                    if (!string.IsNullOrEmpty(b64))
                        return Convert.FromBase64String(b64);
                }
            }
            catch { /* regenerate below */ }
        }

        var key = new byte[32];
        RandomNumberGenerator.Fill(key);
        var json = System.Text.Json.JsonSerializer.Serialize(new
        {
            navigationStateKey = Convert.ToBase64String(key),
        });

        entity ??= new ConfigSectionEntity { Key = MotorSecretsKeys.SectionKey };
        entity.ValueJson = json;
        entity.UpdatedAt = DateTimeOffset.UtcNow;

        if (db.Entry(entity).State == EntityState.Detached)
            db.ConfigSections.Add(entity);
        else
            db.ConfigSections.Update(entity);

        await db.SaveChangesAsync(ct);
        return key;
    }

    private SpeculumDbContext CreateContext()
    {
        var dir = Path.GetDirectoryName(_databasePath);
        if (!string.IsNullOrEmpty(dir))
            Directory.CreateDirectory(dir);
        return new SpeculumDbContext(_databasePath);
    }
}
