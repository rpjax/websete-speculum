using Microsoft.EntityFrameworkCore;

namespace Speculum.Api.BrowserPersistence;

internal sealed class BrowserSessionStateStore
{
    private readonly BrowserSessionDatabase _db;
    private readonly BrowserSessionRegistry _registry;
    private readonly ILogger _logger;

    public BrowserSessionStateStore(
        BrowserSessionDatabase db,
        BrowserSessionRegistry registry,
        ILogger logger)
    {
        _db       = db;
        _registry = registry;
        _logger   = logger;
    }

    public async Task<BrowserStatePayload?> LoadStateAsync(string sessionId, CancellationToken ct = default)
    {
        await using var db = _db.CreateContext();
        await using var conn = db.Database.GetDbConnection();
        await conn.OpenAsync(ct);

        if (!await SessionExistsAndValidAsync(conn, sessionId, ct))
            return null;

        var cookies = await BrowserSessionStateLoaders.LoadCookiesAsync(conn, sessionId, ct);
        var ls      = await BrowserSessionStateLoaders.LoadLocalStorageAsync(conn, sessionId, ct);
        var idb     = await BrowserSessionStateLoaders.LoadIdbAsync(conn, sessionId, ct);
        var history = await BrowserSessionStateLoaders.LoadHistoryAsync(conn, sessionId, ct);

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
        var expires = now.AddDays(_registry.TtlDays);

        await using var db = _db.CreateContext();
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
                BrowserSessionDatabase.AddParam(update, "$updated", now.ToString("O"));
                BrowserSessionDatabase.AddParam(update, "$expires", expires.ToString("O"));
                BrowserSessionDatabase.AddParam(update, "$id", sessionId);
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
                BrowserSessionDatabase.AddParam(cmd, "$sid", sessionId);
                BrowserSessionDatabase.AddParam(cmd, "$name", c.Name);
                BrowserSessionDatabase.AddParam(cmd, "$value", c.Value);
                BrowserSessionDatabase.AddParam(cmd, "$domain", c.Domain);
                BrowserSessionDatabase.AddParam(cmd, "$path", c.Path);
                BrowserSessionDatabase.AddParam(cmd, "$expires", c.Expires.HasValue ? c.Expires.Value : DBNull.Value);
                BrowserSessionDatabase.AddParam(cmd, "$httpOnly", c.HttpOnly ? 1 : 0);
                BrowserSessionDatabase.AddParam(cmd, "$secure", c.Secure ? 1 : 0);
                BrowserSessionDatabase.AddParam(cmd, "$sameSite", c.SameSite ?? (object)DBNull.Value);
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
                BrowserSessionDatabase.AddParam(cmd, "$sid", sessionId);
                BrowserSessionDatabase.AddParam(cmd, "$origin", item.Origin);
                BrowserSessionDatabase.AddParam(cmd, "$key", item.Key);
                BrowserSessionDatabase.AddParam(cmd, "$value", item.Value);
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
                BrowserSessionDatabase.AddParam(cmd, "$sid", sessionId);
                BrowserSessionDatabase.AddParam(cmd, "$origin", item.Origin);
                BrowserSessionDatabase.AddParam(cmd, "$db", item.DatabaseName);
                BrowserSessionDatabase.AddParam(cmd, "$store", item.StoreName);
                BrowserSessionDatabase.AddParam(cmd, "$key", item.KeyJson);
                BrowserSessionDatabase.AddParam(cmd, "$value", item.ValueJson);
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
                BrowserSessionDatabase.AddParam(cmd, "$sid", sessionId);
                BrowserSessionDatabase.AddParam(cmd, "$url", item.Url);
                BrowserSessionDatabase.AddParam(cmd, "$title", item.Title);
                BrowserSessionDatabase.AddParam(cmd, "$visited", item.VisitedAtMs);
                BrowserSessionDatabase.AddParam(cmd, "$transition", item.TransitionType);
                BrowserSessionDatabase.AddParam(cmd, "$idx", item.IndexOrder);
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
        BrowserSessionDatabase.AddParam(cmd, "$id", sessionId);
        BrowserSessionDatabase.AddParam(cmd, "$now", DateTimeOffset.UtcNow.ToString("O"));
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
            BrowserSessionDatabase.AddParam(cmd, "$id", sessionId);
            await cmd.ExecuteNonQueryAsync(ct);
        }
    }
}
