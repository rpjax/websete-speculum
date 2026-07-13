using Microsoft.EntityFrameworkCore;

namespace Speculum.Api.BrowserPersistence;

internal sealed class BrowserSessionAdminQueries
{
    private readonly BrowserSessionDatabase _db;
    private readonly BrowserSessionStateStore _state;
    private readonly ILogger _logger;

    public BrowserSessionAdminQueries(
        BrowserSessionDatabase db,
        BrowserSessionStateStore state,
        ILogger logger)
    {
        _db     = db;
        _state  = state;
        _logger = logger;
    }

    public async Task<IReadOnlyList<BrowserSessionMetadata>> ListSessionsAsync(CancellationToken ct = default)
    {
        await using var db = _db.CreateContext();
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
        BrowserSessionDatabase.AddParam(cmd, "$type", BrowserSessionDatabase.ClientTokenIndexer);

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

        var state = await _state.LoadStateAsync(sessionId, ct) ?? new BrowserStatePayload();

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
        await using var db = _db.CreateContext();
        var rows = await db.Database.ExecuteSqlRawAsync(
            "DELETE FROM browser_sessions WHERE session_id = {0}", [sessionId], ct);
        return rows > 0;
    }

    public async Task PurgeExpiredAsync(CancellationToken ct = default)
    {
        await using var db = _db.CreateContext();
        var rows = await db.Database.ExecuteSqlRawAsync(
            "DELETE FROM browser_sessions WHERE expires_at <= {0}",
            [DateTimeOffset.UtcNow.ToString("O")],
            ct);

        if (rows > 0)
            _logger.LogInformation("Purged {Count} expired browser session(s).", rows);
    }
}
