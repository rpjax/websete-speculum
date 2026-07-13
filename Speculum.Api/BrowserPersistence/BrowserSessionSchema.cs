using Microsoft.EntityFrameworkCore;

namespace Speculum.Api.BrowserPersistence;

internal sealed class BrowserSessionSchema
{
    private readonly BrowserSessionDatabase _db;

    public BrowserSessionSchema(BrowserSessionDatabase db) => _db = db;

    public async Task InitializeAsync(CancellationToken ct = default)
    {
        await using var db = _db.CreateContext();
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
    }
}
