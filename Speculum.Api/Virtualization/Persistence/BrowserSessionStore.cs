using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Speculum.Api.Config.Persistence;
using Speculum.Api.Config.Runtime;

namespace Speculum.Api.Virtualization.Persistence;

public sealed class BrowserSessionStore : IBrowserSessionStore
{
    private const int DefaultTtlDays = 30;
    private const string ClientTokenIndexer = "client_token";

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
    };

    private readonly string _databasePath;
    private readonly ILogger<BrowserSessionStore> _logger;
    private int _ttlDays = DefaultTtlDays;

    public BrowserSessionStore(string databasePath, ILogger<BrowserSessionStore> logger)
    {
        _databasePath = databasePath;
        _logger       = logger;
    }

    public async Task InitializeAsync(CancellationToken ct = default)
    {
        await using var db = CreateContext();
        await db.Database.ExecuteSqlRawAsync(
            """
            DROP TABLE IF EXISTS browser_snapshots;

            CREATE TABLE IF NOT EXISTS browser_sessions (
                session_id TEXT NOT NULL PRIMARY KEY,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                expires_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS browser_session_indexers (
                indexer_type TEXT NOT NULL,
                indexer_key TEXT NOT NULL,
                session_id TEXT NOT NULL,
                PRIMARY KEY (indexer_type, indexer_key),
                FOREIGN KEY (session_id) REFERENCES browser_sessions(session_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS browser_cookies (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                name TEXT NOT NULL,
                value TEXT NOT NULL,
                domain TEXT NOT NULL,
                path TEXT NOT NULL,
                expires REAL NULL,
                http_only INTEGER NOT NULL,
                secure INTEGER NOT NULL,
                same_site TEXT NULL,
                FOREIGN KEY (session_id) REFERENCES browser_sessions(session_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS browser_local_storage (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                origin TEXT NOT NULL,
                key TEXT NOT NULL,
                value TEXT NOT NULL,
                FOREIGN KEY (session_id) REFERENCES browser_sessions(session_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS browser_idb_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                origin TEXT NOT NULL,
                database_name TEXT NOT NULL,
                store_name TEXT NOT NULL,
                key_json TEXT NOT NULL,
                value_json TEXT NOT NULL,
                FOREIGN KEY (session_id) REFERENCES browser_sessions(session_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS browser_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                url TEXT NOT NULL,
                title TEXT NOT NULL,
                visited_at_ms INTEGER NOT NULL,
                transition_type TEXT NOT NULL,
                index_order INTEGER NOT NULL,
                FOREIGN KEY (session_id) REFERENCES browser_sessions(session_id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS ix_browser_sessions_expires_at ON browser_sessions (expires_at);
            CREATE INDEX IF NOT EXISTS ix_browser_cookies_session ON browser_cookies (session_id);
            CREATE INDEX IF NOT EXISTS ix_browser_local_storage_session ON browser_local_storage (session_id);
            CREATE INDEX IF NOT EXISTS ix_browser_idb_records_session ON browser_idb_records (session_id);
            CREATE INDEX IF NOT EXISTS ix_browser_history_session ON browser_history (session_id);
            """, ct);

        await RefreshTtlFromConfigAsync(db, ct);
        await PurgeExpiredAsync(ct);
    }

    public async Task<string> ResolveOrCreateSessionAsync(string clientToken, CancellationToken ct = default)
    {
        await using var db = CreateContext();
        await using var conn = db.Database.GetDbConnection();
        await conn.OpenAsync(ct);

        await using (var lookup = conn.CreateCommand())
        {
            lookup.CommandText = """
                SELECT session_id FROM browser_session_indexers
                WHERE indexer_type = $type AND indexer_key = $key
                """;
            AddParam(lookup, "$type", ClientTokenIndexer);
            AddParam(lookup, "$key", clientToken);

            var existing = await lookup.ExecuteScalarAsync(ct);
            if (existing is string sessionId)
                return sessionId;
        }

        var newSessionId = Guid.NewGuid().ToString("N");
        var now          = DateTimeOffset.UtcNow;
        var expires      = now.AddDays(_ttlDays);

        await using (var insertSession = conn.CreateCommand())
        {
            insertSession.CommandText = """
                INSERT INTO browser_sessions (session_id, created_at, updated_at, expires_at)
                VALUES ($id, $created, $updated, $expires)
                """;
            AddParam(insertSession, "$id", newSessionId);
            AddParam(insertSession, "$created", now.ToString("O"));
            AddParam(insertSession, "$updated", now.ToString("O"));
            AddParam(insertSession, "$expires", expires.ToString("O"));
            await insertSession.ExecuteNonQueryAsync(ct);
        }

        await using (var insertIndexer = conn.CreateCommand())
        {
            insertIndexer.CommandText = """
                INSERT INTO browser_session_indexers (indexer_type, indexer_key, session_id)
                VALUES ($type, $key, $id)
                """;
            AddParam(insertIndexer, "$type", ClientTokenIndexer);
            AddParam(insertIndexer, "$key", clientToken);
            AddParam(insertIndexer, "$id", newSessionId);
            await insertIndexer.ExecuteNonQueryAsync(ct);
        }

        return newSessionId;
    }

    public async Task<BrowserStatePayload?> LoadStateAsync(string sessionId, CancellationToken ct = default)
    {
        await using var db = CreateContext();
        await using var conn = db.Database.GetDbConnection();
        await conn.OpenAsync(ct);

        if (!await SessionExistsAndValidAsync(conn, sessionId, ct))
            return null;

        var cookies = await LoadCookiesAsync(conn, sessionId, ct);
        var ls      = await LoadLocalStorageAsync(conn, sessionId, ct);
        var idb     = await LoadIdbAsync(conn, sessionId, ct);
        var history = await LoadHistoryAsync(conn, sessionId, ct);

        if (cookies.Count == 0 && ls.Count == 0 && idb.Count == 0 && history.Count == 0)
            return null;

        return new BrowserStatePayload
        {
            Cookies      = cookies,
            LocalStorage = ls,
            IdbRecords   = idb,
            History      = history,
        };
    }

    public async Task SaveStateAsync(string sessionId, BrowserStatePayload state, CancellationToken ct = default)
    {
        var now     = DateTimeOffset.UtcNow;
        var expires = now.AddDays(_ttlDays);

        await using var db = CreateContext();
        await using var conn = db.Database.GetDbConnection();
        await conn.OpenAsync(ct);
        await using var tx = await conn.BeginTransactionAsync(ct);

        try
        {
            await using (var update = conn.CreateCommand())
            {
                update.Transaction = tx;
                update.CommandText = """
                    UPDATE browser_sessions SET updated_at = $updated, expires_at = $expires
                    WHERE session_id = $id
                    """;
                AddParam(update, "$updated", now.ToString("O"));
                AddParam(update, "$expires", expires.ToString("O"));
                AddParam(update, "$id", sessionId);
                await update.ExecuteNonQueryAsync(ct);
            }

            await DeleteStateForSessionAsync(conn, tx, sessionId, ct);

            foreach (var c in state.Cookies)
            {
                await using var cmd = conn.CreateCommand();
                cmd.Transaction = tx;
                cmd.CommandText = """
                    INSERT INTO browser_cookies
                    (session_id, name, value, domain, path, expires, http_only, secure, same_site)
                    VALUES ($sid, $name, $value, $domain, $path, $expires, $httpOnly, $secure, $sameSite)
                    """;
                AddParam(cmd, "$sid", sessionId);
                AddParam(cmd, "$name", c.Name);
                AddParam(cmd, "$value", c.Value);
                AddParam(cmd, "$domain", c.Domain);
                AddParam(cmd, "$path", c.Path);
                AddParam(cmd, "$expires", c.Expires.HasValue ? c.Expires.Value : DBNull.Value);
                AddParam(cmd, "$httpOnly", c.HttpOnly ? 1 : 0);
                AddParam(cmd, "$secure", c.Secure ? 1 : 0);
                AddParam(cmd, "$sameSite", c.SameSite ?? (object)DBNull.Value);
                await cmd.ExecuteNonQueryAsync(ct);
            }

            foreach (var item in state.LocalStorage)
            {
                await using var cmd = conn.CreateCommand();
                cmd.Transaction = tx;
                cmd.CommandText = """
                    INSERT INTO browser_local_storage (session_id, origin, key, value)
                    VALUES ($sid, $origin, $key, $value)
                    """;
                AddParam(cmd, "$sid", sessionId);
                AddParam(cmd, "$origin", item.Origin);
                AddParam(cmd, "$key", item.Key);
                AddParam(cmd, "$value", item.Value);
                await cmd.ExecuteNonQueryAsync(ct);
            }

            foreach (var item in state.IdbRecords)
            {
                await using var cmd = conn.CreateCommand();
                cmd.Transaction = tx;
                cmd.CommandText = """
                    INSERT INTO browser_idb_records
                    (session_id, origin, database_name, store_name, key_json, value_json)
                    VALUES ($sid, $origin, $db, $store, $key, $value)
                    """;
                AddParam(cmd, "$sid", sessionId);
                AddParam(cmd, "$origin", item.Origin);
                AddParam(cmd, "$db", item.DatabaseName);
                AddParam(cmd, "$store", item.StoreName);
                AddParam(cmd, "$key", item.KeyJson);
                AddParam(cmd, "$value", item.ValueJson);
                await cmd.ExecuteNonQueryAsync(ct);
            }

            foreach (var item in state.History)
            {
                await using var cmd = conn.CreateCommand();
                cmd.Transaction = tx;
                cmd.CommandText = """
                    INSERT INTO browser_history
                    (session_id, url, title, visited_at_ms, transition_type, index_order)
                    VALUES ($sid, $url, $title, $visited, $transition, $idx)
                    """;
                AddParam(cmd, "$sid", sessionId);
                AddParam(cmd, "$url", item.Url);
                AddParam(cmd, "$title", item.Title);
                AddParam(cmd, "$visited", item.VisitedAtMs);
                AddParam(cmd, "$transition", item.TransitionType);
                AddParam(cmd, "$idx", item.IndexOrder);
                await cmd.ExecuteNonQueryAsync(ct);
            }

            await tx.CommitAsync(ct);

            _logger.LogInformation(
                "Browser state saved for session {SessionPrefix}… (cookies={Cookies}, ls={Ls}, idb={Idb}, history={History})",
                sessionId[..Math.Min(8, sessionId.Length)],
                state.Cookies.Count, state.LocalStorage.Count, state.IdbRecords.Count, state.History.Count);
        }
        catch
        {
            await tx.RollbackAsync(ct);
            throw;
        }
    }

    public async Task<IReadOnlyList<BrowserSessionMetadata>> ListSessionsAsync(CancellationToken ct = default)
    {
        await using var db = CreateContext();
        await using var conn = db.Database.GetDbConnection();
        await conn.OpenAsync(ct);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            SELECT s.session_id, s.created_at, s.updated_at, s.expires_at,
                   COALESCE(i.indexer_key, '') AS client_token,
                   (SELECT COUNT(*) FROM browser_cookies c WHERE c.session_id = s.session_id),
                   (SELECT COUNT(*) FROM browser_local_storage l WHERE l.session_id = s.session_id),
                   (SELECT COUNT(*) FROM browser_idb_records d WHERE d.session_id = s.session_id),
                   (SELECT COUNT(*) FROM browser_history h WHERE h.session_id = s.session_id)
            FROM browser_sessions s
            LEFT JOIN browser_session_indexers i
                ON i.session_id = s.session_id AND i.indexer_type = $type
            ORDER BY s.updated_at DESC
            """;
        AddParam(cmd, "$type", ClientTokenIndexer);

        var list = new List<BrowserSessionMetadata>();
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            list.Add(new BrowserSessionMetadata
            {
                SessionId         = reader.GetString(0),
                CreatedAt         = DateTimeOffset.Parse(reader.GetString(1)),
                UpdatedAt         = DateTimeOffset.Parse(reader.GetString(2)),
                ExpiresAt         = DateTimeOffset.Parse(reader.GetString(3)),
                ClientToken       = reader.GetString(4),
                CookieCount       = reader.GetInt32(5),
                LocalStorageCount = reader.GetInt32(6),
                IdbRecordCount    = reader.GetInt32(7),
                HistoryCount      = reader.GetInt32(8),
            });
        }

        return list;
    }

    public async Task<BrowserSessionDetail?> GetSessionDetailAsync(string sessionId, CancellationToken ct = default)
    {
        var list = await ListSessionsAsync(ct);
        var meta = list.FirstOrDefault(s => s.SessionId == sessionId);
        if (meta is null) return null;

        var state = await LoadStateAsync(sessionId, ct) ?? new BrowserStatePayload();

        return new BrowserSessionDetail
        {
            SessionId         = meta.SessionId,
            ClientToken       = meta.ClientToken,
            CreatedAt         = meta.CreatedAt,
            UpdatedAt         = meta.UpdatedAt,
            ExpiresAt         = meta.ExpiresAt,
            CookieCount       = meta.CookieCount,
            LocalStorageCount = meta.LocalStorageCount,
            IdbRecordCount    = meta.IdbRecordCount,
            HistoryCount      = meta.HistoryCount,
            Cookies           = state.Cookies,
            LocalStorage      = state.LocalStorage,
            IdbRecords        = state.IdbRecords,
            History           = state.History,
        };
    }

    public async Task<bool> DeleteSessionAsync(string sessionId, CancellationToken ct = default)
    {
        await using var db = CreateContext();
        var rows = await db.Database.ExecuteSqlRawAsync(
            "DELETE FROM browser_sessions WHERE session_id = {0}", [sessionId], ct);
        return rows > 0;
    }

    public async Task PurgeExpiredAsync(CancellationToken ct = default)
    {
        await using var db = CreateContext();
        var rows = await db.Database.ExecuteSqlRawAsync(
            "DELETE FROM browser_sessions WHERE expires_at <= {0}",
            [DateTimeOffset.UtcNow.ToString("O")],
            ct);

        if (rows > 0)
            _logger.LogInformation("Purged {Count} expired browser session(s).", rows);
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
                .FirstOrDefaultAsync(e => e.Key == ConfigSectionKeys.SessionPolicy
                                       || e.Key == ConfigSectionKeys.SnapshotPolicy, ct);

            if (entity?.ValueJson is null)
            {
                _ttlDays = DefaultTtlDays;
                return;
            }

            var policy = JsonSerializer.Deserialize<SessionPolicyOptions>(entity.ValueJson, JsonOptions);
            _ttlDays = policy?.TtlDays > 0 ? policy.TtlDays : DefaultTtlDays;
        }
        catch
        {
            _ttlDays = DefaultTtlDays;
        }
    }

    private static async Task<bool> SessionExistsAndValidAsync(
        System.Data.Common.DbConnection conn,
        string sessionId,
        CancellationToken ct)
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            SELECT 1 FROM browser_sessions
            WHERE session_id = $id AND expires_at > $now
            """;
        AddParam(cmd, "$id", sessionId);
        AddParam(cmd, "$now", DateTimeOffset.UtcNow.ToString("O"));
        return await cmd.ExecuteScalarAsync(ct) is not null;
    }

    private static async Task DeleteStateForSessionAsync(
        System.Data.Common.DbConnection conn,
        System.Data.Common.DbTransaction tx,
        string sessionId,
        CancellationToken ct)
    {
        foreach (var table in new[] { "browser_cookies", "browser_local_storage", "browser_idb_records", "browser_history" })
        {
            await using var cmd = conn.CreateCommand();
            cmd.Transaction = tx;
            cmd.CommandText = $"DELETE FROM {table} WHERE session_id = $id";
            AddParam(cmd, "$id", sessionId);
            await cmd.ExecuteNonQueryAsync(ct);
        }
    }

    private static async Task<List<BrowserCookieState>> LoadCookiesAsync(
        System.Data.Common.DbConnection conn, string sessionId, CancellationToken ct)
    {
        var list = new List<BrowserCookieState>();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            SELECT name, value, domain, path, expires, http_only, secure, same_site
            FROM browser_cookies WHERE session_id = $id
            """;
        AddParam(cmd, "$id", sessionId);
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            list.Add(new BrowserCookieState
            {
                Name     = reader.GetString(0),
                Value    = reader.GetString(1),
                Domain   = reader.GetString(2),
                Path     = reader.GetString(3),
                Expires  = reader.IsDBNull(4) ? null : reader.GetDouble(4),
                HttpOnly = reader.GetInt32(5) != 0,
                Secure   = reader.GetInt32(6) != 0,
                SameSite = reader.IsDBNull(7) ? null : reader.GetString(7),
            });
        }
        return list;
    }

    private static async Task<List<BrowserLocalStorageState>> LoadLocalStorageAsync(
        System.Data.Common.DbConnection conn, string sessionId, CancellationToken ct)
    {
        var list = new List<BrowserLocalStorageState>();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            SELECT origin, key, value FROM browser_local_storage WHERE session_id = $id
            """;
        AddParam(cmd, "$id", sessionId);
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            list.Add(new BrowserLocalStorageState
            {
                Origin = reader.GetString(0),
                Key    = reader.GetString(1),
                Value  = reader.GetString(2),
            });
        }
        return list;
    }

    private static async Task<List<BrowserIdbRecordState>> LoadIdbAsync(
        System.Data.Common.DbConnection conn, string sessionId, CancellationToken ct)
    {
        var list = new List<BrowserIdbRecordState>();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            SELECT origin, database_name, store_name, key_json, value_json
            FROM browser_idb_records WHERE session_id = $id
            """;
        AddParam(cmd, "$id", sessionId);
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            list.Add(new BrowserIdbRecordState
            {
                Origin       = reader.GetString(0),
                DatabaseName = reader.GetString(1),
                StoreName    = reader.GetString(2),
                KeyJson      = reader.GetString(3),
                ValueJson    = reader.GetString(4),
            });
        }
        return list;
    }

    private static async Task<List<BrowserHistoryState>> LoadHistoryAsync(
        System.Data.Common.DbConnection conn, string sessionId, CancellationToken ct)
    {
        var list = new List<BrowserHistoryState>();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            SELECT url, title, visited_at_ms, transition_type, index_order
            FROM browser_history WHERE session_id = $id ORDER BY index_order
            """;
        AddParam(cmd, "$id", sessionId);
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            list.Add(new BrowserHistoryState
            {
                Url             = reader.GetString(0),
                Title           = reader.GetString(1),
                VisitedAtMs     = reader.GetInt64(2),
                TransitionType  = reader.GetString(3),
                IndexOrder      = reader.GetInt32(4),
            });
        }
        return list;
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
