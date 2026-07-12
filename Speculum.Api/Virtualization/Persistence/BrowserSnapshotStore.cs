using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Speculum.Api.Config.Persistence;
using Speculum.Api.Config.Runtime;
using Speculum.Api.Config.Store;

namespace Speculum.Api.Virtualization.Persistence;

public sealed class BrowserSnapshotStore : IBrowserSnapshotStore
{
    private const int DefaultTtlDays = 30;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
    };

    private readonly string _databasePath;
    private readonly ILogger<BrowserSnapshotStore> _logger;
    private int _ttlDays = DefaultTtlDays;

    public BrowserSnapshotStore(string databasePath, ILogger<BrowserSnapshotStore> logger)
    {
        _databasePath = databasePath;
        _logger       = logger;
    }

    public int TtlDays => _ttlDays;

    public async Task InitializeAsync(CancellationToken ct = default)
    {
        await using var db = CreateContext();
        await db.Database.ExecuteSqlRawAsync(
            """
            CREATE TABLE IF NOT EXISTS browser_snapshots (
                cookie_id TEXT NOT NULL PRIMARY KEY,
                profile_blob BLOB NOT NULL,
                last_url TEXT NOT NULL,
                byte_size INTEGER NOT NULL,
                updated_at TEXT NOT NULL,
                expires_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS ix_browser_snapshots_expires_at
                ON browser_snapshots (expires_at);
            """, ct);

        await RefreshTtlFromConfigAsync(db, ct);
        await PurgeExpiredAsync(ct);
    }

    public async Task<BrowserSnapshotRecord?> TryLoadAsync(string sessionId, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(sessionId)) return null;

        await using var db = CreateContext();
        await using var conn = db.Database.GetDbConnection();
        await conn.OpenAsync(ct);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            SELECT profile_blob, last_url, updated_at
            FROM browser_snapshots
            WHERE cookie_id = $id AND expires_at > $now
            """;
        AddParam(cmd, "$id", sessionId);
        AddParam(cmd, "$now", DateTimeOffset.UtcNow.ToString("O"));

        await using var reader = await cmd.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct)) return null;

        return new BrowserSnapshotRecord
        {
            SessionId   = sessionId,
            ProfileBlob = (byte[])reader["profile_blob"],
            LastUrl     = reader.GetString(1),
            UpdatedAt   = DateTimeOffset.Parse(reader.GetString(2)),
        };
    }

    public async Task SaveAsync(string sessionId, byte[] profileBlob, string lastUrl, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(sessionId))
            throw new ArgumentException("Session id is required.", nameof(sessionId));

        var now     = DateTimeOffset.UtcNow;
        var expires = now.AddDays(_ttlDays);

        await using var db = CreateContext();
        await db.Database.ExecuteSqlRawAsync(
            """
            INSERT INTO browser_snapshots (cookie_id, profile_blob, last_url, byte_size, updated_at, expires_at)
            VALUES ({0}, {1}, {2}, {3}, {4}, {5})
            ON CONFLICT(cookie_id) DO UPDATE SET
                profile_blob = excluded.profile_blob,
                last_url = excluded.last_url,
                byte_size = excluded.byte_size,
                updated_at = excluded.updated_at,
                expires_at = excluded.expires_at
            """,
            [sessionId, profileBlob, lastUrl, profileBlob.Length, now.ToString("O"), expires.ToString("O")],
            ct);

        _logger.LogInformation(
            "Snapshot saved for session {SessionPrefix}… ({Bytes} bytes, url={Url})",
            sessionId[..Math.Min(8, sessionId.Length)], profileBlob.Length, lastUrl);
    }

    public async Task<IReadOnlyList<BrowserSnapshotMetadata>> ListAsync(CancellationToken ct = default)
    {
        await using var db = CreateContext();
        await using var conn = db.Database.GetDbConnection();
        await conn.OpenAsync(ct);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            SELECT cookie_id, last_url, byte_size, updated_at, expires_at
            FROM browser_snapshots
            ORDER BY updated_at DESC
            """;

        var list = new List<BrowserSnapshotMetadata>();
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            list.Add(new BrowserSnapshotMetadata
            {
                SessionId = reader.GetString(0),
                LastUrl   = reader.GetString(1),
                ByteSize  = reader.GetInt32(2),
                UpdatedAt = DateTimeOffset.Parse(reader.GetString(3)),
                ExpiresAt = DateTimeOffset.Parse(reader.GetString(4)),
            });
        }

        return list;
    }

    public async Task<bool> DeleteAsync(string sessionId, CancellationToken ct = default)
    {
        await using var db = CreateContext();
        var rows = await db.Database.ExecuteSqlRawAsync(
            "DELETE FROM browser_snapshots WHERE cookie_id = {0}", [sessionId], ct);
        return rows > 0;
    }

    public async Task PurgeExpiredAsync(CancellationToken ct = default)
    {
        await using var db = CreateContext();
        var rows = await db.Database.ExecuteSqlRawAsync(
            "DELETE FROM browser_snapshots WHERE expires_at <= {0}",
            [DateTimeOffset.UtcNow.ToString("O")],
            ct);

        if (rows > 0)
            _logger.LogInformation("Purged {Count} expired browser snapshot(s).", rows);
    }

    public async Task RefreshPolicyAsync(CancellationToken ct = default)
    {
        await using var db = CreateContext();
        await RefreshTtlFromConfigAsync(db, ct);
        await PurgeExpiredAsync(ct);
    }

    private async Task RefreshTtlFromConfigAsync(SpeculumDbContext db, CancellationToken ct)
    {
        try
        {
            var entity = await db.ConfigSections.AsNoTracking()
                .FirstOrDefaultAsync(e => e.Key == ConfigSectionKeys.SnapshotPolicy, ct);

            if (entity?.ValueJson is null)
            {
                _ttlDays = DefaultTtlDays;
                return;
            }

            var policy = JsonSerializer.Deserialize<SnapshotPolicyOptions>(entity.ValueJson, JsonOptions);
            _ttlDays = policy?.TtlDays > 0 ? policy.TtlDays : DefaultTtlDays;
        }
        catch
        {
            _ttlDays = DefaultTtlDays;
        }
    }

    private SpeculumDbContext CreateContext() => new(_databasePath);

    private static void AddParam(System.Data.Common.DbCommand cmd, string name, object value)
    {
        var p = cmd.CreateParameter();
        p.ParameterName = name;
        p.Value         = value;
        cmd.Parameters.Add(p);
    }
}
