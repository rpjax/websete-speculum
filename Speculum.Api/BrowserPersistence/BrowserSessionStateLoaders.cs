namespace Speculum.Api.BrowserPersistence;

internal static class BrowserSessionStateLoaders
{
    public static async Task<List<BrowserCookieState>> LoadCookiesAsync(
        System.Data.Common.DbConnection conn, string sessionId, CancellationToken ct)
    {
        var list = new List<BrowserCookieState>();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            SELECT name, value, domain, path, expires, http_only, secure, same_site
            FROM browser_cookies WHERE session_id = $id
            """;
        BrowserSessionDatabase.AddParam(cmd, "$id", sessionId);
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

    public static async Task<List<BrowserLocalStorageState>> LoadLocalStorageAsync(
        System.Data.Common.DbConnection conn, string sessionId, CancellationToken ct)
    {
        var list = new List<BrowserLocalStorageState>();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            SELECT origin, key, value FROM browser_local_storage WHERE session_id = $id
            """;
        BrowserSessionDatabase.AddParam(cmd, "$id", sessionId);
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

    public static async Task<List<BrowserIdbRecordState>> LoadIdbAsync(
        System.Data.Common.DbConnection conn, string sessionId, CancellationToken ct)
    {
        var list = new List<BrowserIdbRecordState>();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            SELECT origin, database_name, store_name, key_json, value_json
            FROM browser_idb_records WHERE session_id = $id
            """;
        BrowserSessionDatabase.AddParam(cmd, "$id", sessionId);
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

    public static async Task<List<BrowserHistoryState>> LoadHistoryAsync(
        System.Data.Common.DbConnection conn,
        string sessionId,
        CancellationToken ct,
        System.Data.Common.DbTransaction? tx = null)
    {
        var list = new List<BrowserHistoryState>();
        await using var cmd = conn.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = """
            SELECT url, title, visited_at_ms, transition_type, index_order
            FROM browser_history WHERE session_id = $id ORDER BY index_order
            """;
        BrowserSessionDatabase.AddParam(cmd, "$id", sessionId);
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            list.Add(new BrowserHistoryState
            {
                Url            = reader.GetString(0),
                Title          = reader.GetString(1),
                VisitedAtMs    = reader.GetInt64(2),
                TransitionType = reader.GetString(3),
                IndexOrder     = reader.GetInt32(4),
            });
        }
        return list;
    }
}
