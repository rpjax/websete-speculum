using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Speculum.Api.Config.Persistence;

namespace Speculum.Api.Scripts;

public interface IInjectedScriptStore
{
    Task InitializeAsync(CancellationToken ct = default);
    Task<InjectedScriptMetadata> SaveAsync(string name, string content, CancellationToken ct = default);
    Task<InjectedScriptEntity?> TryGetAsync(string id, CancellationToken ct = default);
    Task<IReadOnlyList<InjectedScriptMetadata>> ListAsync(CancellationToken ct = default);
    Task<bool> DeleteAsync(string id, CancellationToken ct = default);
    Task<bool> ExistsAsync(string id, CancellationToken ct = default);
}

public sealed class InjectedScriptStore : IInjectedScriptStore
{
    private readonly string _databasePath;

    public InjectedScriptStore(string databasePath)
    {
        _databasePath = databasePath;
    }

    public async Task InitializeAsync(CancellationToken ct = default)
    {
        await using var db = CreateContext();
        await db.Database.ExecuteSqlRawAsync(
            """
            CREATE TABLE IF NOT EXISTS injected_scripts (
                id TEXT NOT NULL PRIMARY KEY,
                name TEXT NOT NULL,
                content TEXT NOT NULL,
                sha256 TEXT NOT NULL,
                size INTEGER NOT NULL,
                uploaded_at TEXT NOT NULL
            );
            """, ct);
    }

    public async Task<InjectedScriptMetadata> SaveAsync(string name, string content, CancellationToken ct = default)
    {
        var id   = Guid.NewGuid().ToString("N");
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(content))).ToLowerInvariant();
        var now  = DateTimeOffset.UtcNow;

        await using var db = CreateContext();
        await db.Database.ExecuteSqlRawAsync(
            """
            INSERT INTO injected_scripts (id, name, content, sha256, size, uploaded_at)
            VALUES ({0}, {1}, {2}, {3}, {4}, {5})
            """,
            [id, name, content, hash, content.Length, now.ToString("O")],
            ct);

        return new InjectedScriptMetadata
        {
            Id         = id,
            Name       = name,
            Sha256     = hash,
            Size       = content.Length,
            UploadedAt = now,
        };
    }

    public async Task<InjectedScriptEntity?> TryGetAsync(string id, CancellationToken ct = default)
    {
        await using var db = CreateContext();
        await using var conn = db.Database.GetDbConnection();
        await conn.OpenAsync(ct);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            SELECT id, name, content, sha256, size, uploaded_at
            FROM injected_scripts WHERE id = $id
            """;
        var p = cmd.CreateParameter();
        p.ParameterName = "$id";
        p.Value         = id;
        cmd.Parameters.Add(p);

        await using var reader = await cmd.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct)) return null;

        return new InjectedScriptEntity
        {
            Id         = reader.GetString(0),
            Name       = reader.GetString(1),
            Content    = reader.GetString(2),
            Sha256     = reader.GetString(3),
            Size       = reader.GetInt32(4),
            UploadedAt = DateTimeOffset.Parse(reader.GetString(5)),
        };
    }

    public async Task<IReadOnlyList<InjectedScriptMetadata>> ListAsync(CancellationToken ct = default)
    {
        await using var db = CreateContext();
        await using var conn = db.Database.GetDbConnection();
        await conn.OpenAsync(ct);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            SELECT id, name, sha256, size, uploaded_at
            FROM injected_scripts ORDER BY uploaded_at DESC
            """;

        var list = new List<InjectedScriptMetadata>();
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            list.Add(new InjectedScriptMetadata
            {
                Id         = reader.GetString(0),
                Name       = reader.GetString(1),
                Sha256     = reader.GetString(2),
                Size       = reader.GetInt32(3),
                UploadedAt = DateTimeOffset.Parse(reader.GetString(4)),
            });
        }

        return list;
    }

    public async Task<bool> DeleteAsync(string id, CancellationToken ct = default)
    {
        await using var db = CreateContext();
        var rows = await db.Database.ExecuteSqlRawAsync(
            "DELETE FROM injected_scripts WHERE id = {0}", [id], ct);
        return rows > 0;
    }

    public async Task<bool> ExistsAsync(string id, CancellationToken ct = default)
        => await TryGetAsync(id, ct) is not null;

    private SpeculumDbContext CreateContext() => new(_databasePath);
}
