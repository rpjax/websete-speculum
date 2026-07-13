using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Speculum.Api.Config.Persistence;
using Speculum.Api.Config.Runtime;
using Speculum.Api.Motor.Live;

namespace Speculum.Api.BrowserPersistence;

internal sealed class BrowserSessionRegistry
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
    };

    private readonly BrowserSessionDatabase _db;
    private int _ttlDays = BrowserSessionDatabase.DefaultTtlDays;

    public BrowserSessionRegistry(BrowserSessionDatabase db) => _db = db;

    internal int TtlDays => _ttlDays;

    public async Task<string> ResolveOrCreateSessionAsync(string clientToken, CancellationToken ct = default)
    {
        var (sessionId, _) = await ResolveOrCreateSessionAsync(
            new SessionIdentity { ClientToken = clientToken }, ct);
        return sessionId;
    }

    public async Task<(string SessionId, string ClientToken)> ResolveOrCreateSessionAsync(
        SessionIdentity identity,
        CancellationToken ct = default)
    {
        var indexers = new Dictionary<string, string>(StringComparer.Ordinal);

        if (!string.IsNullOrWhiteSpace(identity.ClientToken))
            indexers[BrowserSessionDatabase.ClientTokenIndexer] = ClientTokenNormalizer.Resolve(identity.ClientToken);

        if (identity.Indexers is not null)
        {
            foreach (var (type, key) in identity.Indexers)
            {
                if (string.IsNullOrWhiteSpace(type) || string.IsNullOrWhiteSpace(key))
                    continue;
                indexers[type.Trim()] = key.Trim();
            }
        }

        await using var db = _db.CreateContext();
        await using var conn = db.Database.GetDbConnection();
        await conn.OpenAsync(ct);

        foreach (var (type, key) in indexers)
        {
            await using var lookup = conn.CreateCommand();
            lookup.CommandText = """
                SELECT session_id FROM browser_session_indexers
                WHERE indexer_type = $type AND indexer_key = $key
                """;
            BrowserSessionDatabase.AddParam(lookup, "$type", type);
            BrowserSessionDatabase.AddParam(lookup, "$key", key);

            var existing = await lookup.ExecuteScalarAsync(ct);
            if (existing is string sessionId)
            {
                var token = indexers.GetValueOrDefault(BrowserSessionDatabase.ClientTokenIndexer)
                            ?? await GetClientTokenForSessionAsync(conn, sessionId, ct)
                            ?? ClientTokenNormalizer.Resolve(null);
                return (sessionId, token);
            }
        }

        var resolvedToken = indexers.GetValueOrDefault(BrowserSessionDatabase.ClientTokenIndexer)
                            ?? ClientTokenNormalizer.Resolve(null);
        indexers[BrowserSessionDatabase.ClientTokenIndexer] = resolvedToken;

        var newSessionId = Guid.NewGuid().ToString("N");
        var now          = DateTimeOffset.UtcNow;
        var expires      = now.AddDays(_ttlDays);

        await using (var insertSession = conn.CreateCommand())
        {
            insertSession.CommandText = """
                INSERT INTO browser_sessions (session_id, created_at, updated_at, expires_at)
                VALUES ($id, $created, $updated, $expires)
                """;
            BrowserSessionDatabase.AddParam(insertSession, "$id", newSessionId);
            BrowserSessionDatabase.AddParam(insertSession, "$created", now.ToString("O"));
            BrowserSessionDatabase.AddParam(insertSession, "$updated", now.ToString("O"));
            BrowserSessionDatabase.AddParam(insertSession, "$expires", expires.ToString("O"));
            await insertSession.ExecuteNonQueryAsync(ct);
        }

        foreach (var (type, key) in indexers)
        {
            await using var insertIndexer = conn.CreateCommand();
            insertIndexer.CommandText = """
                INSERT OR IGNORE INTO browser_session_indexers (indexer_type, indexer_key, session_id)
                VALUES ($type, $key, $id)
                """;
            BrowserSessionDatabase.AddParam(insertIndexer, "$type", type);
            BrowserSessionDatabase.AddParam(insertIndexer, "$key", key);
            BrowserSessionDatabase.AddParam(insertIndexer, "$id", newSessionId);
            await insertIndexer.ExecuteNonQueryAsync(ct);
        }

        return (newSessionId, resolvedToken);
    }

    internal async Task RefreshTtlFromConfigAsync(SpeculumDbContext db, CancellationToken ct)
    {
        try
        {
            var entity = await db.ConfigSections.AsNoTracking()
                .FirstOrDefaultAsync(e => e.Key == ConfigSectionKeys.SessionPolicy, ct);

            if (entity?.ValueJson is null)
            {
                _ttlDays = BrowserSessionDatabase.DefaultTtlDays;
                return;
            }

            var policy = JsonSerializer.Deserialize<SessionPolicyOptions>(entity.ValueJson, JsonOptions);
            _ttlDays = policy?.TtlDays > 0 ? policy.TtlDays : BrowserSessionDatabase.DefaultTtlDays;
        }
        catch
        {
            _ttlDays = BrowserSessionDatabase.DefaultTtlDays;
        }
    }

    internal async Task RefreshTtlFromConfigAsync(CancellationToken ct)
    {
        await using var db = _db.CreateContext();
        await RefreshTtlFromConfigAsync(db, ct);
    }

    private static async Task<string?> GetClientTokenForSessionAsync(
        System.Data.Common.DbConnection conn,
        string sessionId,
        CancellationToken ct)
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            SELECT indexer_key FROM browser_session_indexers
            WHERE indexer_type = $type AND session_id = $id
            LIMIT 1
            """;
        BrowserSessionDatabase.AddParam(cmd, "$type", BrowserSessionDatabase.ClientTokenIndexer);
        BrowserSessionDatabase.AddParam(cmd, "$id", sessionId);
        var result = await cmd.ExecuteScalarAsync(ct);
        return result as string;
    }
}
