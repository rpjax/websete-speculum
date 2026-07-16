using Microsoft.Data.Sqlite;
using Speculum.Api.Diagnostics.Abstractions;
using Speculum.Api.Diagnostics.Configuration;
using Speculum.Api.Diagnostics.Emitters;
using System.Text.Json;

namespace Speculum.Api.Diagnostics.Pipeline;

/// <summary>A keyset-paginated page of diagnostics events plus the total matching count.</summary>
public sealed record DiagnosticsEventPage(
    IReadOnlyList<DiagnosticsEvent> Items,
    long Total,
    string? NextCursor);

public sealed class SqliteDiagnosticsEventSink : IDiagnosticsSink
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    private readonly string _connectionString;
    private readonly IDiagnosticsRuntime _runtime;
    private readonly Lazy<IDiagnosticsSelfEmitter> _self;
    private readonly object _writeLock = new();

    public SqliteDiagnosticsEventSink(
        string databasePath,
        IDiagnosticsRuntime runtime,
        Lazy<IDiagnosticsSelfEmitter> self)
    {
        var dir = Path.GetDirectoryName(databasePath);
        if (!string.IsNullOrEmpty(dir))
            Directory.CreateDirectory(dir);

        var path = Path.Combine(
            Path.GetDirectoryName(databasePath) ?? ".",
            Path.GetFileNameWithoutExtension(databasePath) + ".diagnostics.db");

        _connectionString = new SqliteConnectionStringBuilder { DataSource = path }.ToString();
        _runtime = runtime;
        _self = self;
        EnsureSchema();
    }

    public string DatabasePath
    {
        get
        {
            using var conn = Open();
            return conn.DataSource;
        }
    }

    public ValueTask WriteAsync(DiagnosticsEvent diagnosticsEvent, CancellationToken ct = default)
    {
        var json = JsonSerializer.Serialize(new
        {
            diagnosticsSchemaVersion = diagnosticsEvent.DiagnosticsSchemaVersion,
            id = diagnosticsEvent.Id,
            utc = diagnosticsEvent.Utc,
            domain = diagnosticsEvent.Domain.ToString(),
            name = diagnosticsEvent.Name,
            severity = diagnosticsEvent.Severity.ToString(),
            correlationId = diagnosticsEvent.CorrelationId,
            connectionId = diagnosticsEvent.ConnectionId,
            persistedSessionId = diagnosticsEvent.PersistedSessionId,
            sidecarSessionId = diagnosticsEvent.SidecarSessionId,
            seq = diagnosticsEvent.Seq,
            spanId = diagnosticsEvent.SpanId,
            spanKey = diagnosticsEvent.SpanKey,
            causationId = diagnosticsEvent.CausationId,
            payload = diagnosticsEvent.Payload,
        }, JsonOptions);

        lock (_writeLock)
        {
            using var conn = Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText =
                """
                INSERT INTO diag_events (
                    id, utc, domain, name, severity, correlation_id,
                    connection_id, persisted_session_id, sidecar_session_id,
                    seq, span_id, span_key, causation_id, payload_json, bytes
                ) VALUES (
                    $id, $utc, $domain, $name, $severity, $correlation_id,
                    $connection_id, $persisted_session_id, $sidecar_session_id,
                    $seq, $span_id, $span_key, $causation_id, $payload_json, $bytes
                );
                """;
            cmd.Parameters.AddWithValue("$id", diagnosticsEvent.Id);
            cmd.Parameters.AddWithValue("$utc", diagnosticsEvent.Utc.ToString("O"));
            cmd.Parameters.AddWithValue("$domain", diagnosticsEvent.Domain.ToString());
            cmd.Parameters.AddWithValue("$name", diagnosticsEvent.Name);
            cmd.Parameters.AddWithValue("$severity", diagnosticsEvent.Severity.ToString());
            cmd.Parameters.AddWithValue("$correlation_id", (object?)diagnosticsEvent.CorrelationId ?? DBNull.Value);
            cmd.Parameters.AddWithValue("$connection_id", (object?)diagnosticsEvent.ConnectionId ?? DBNull.Value);
            cmd.Parameters.AddWithValue("$persisted_session_id", (object?)diagnosticsEvent.PersistedSessionId ?? DBNull.Value);
            cmd.Parameters.AddWithValue("$sidecar_session_id", (object?)diagnosticsEvent.SidecarSessionId ?? DBNull.Value);
            cmd.Parameters.AddWithValue("$seq", diagnosticsEvent.Seq);
            cmd.Parameters.AddWithValue("$span_id", (object?)diagnosticsEvent.SpanId ?? DBNull.Value);
            cmd.Parameters.AddWithValue("$span_key", (object?)diagnosticsEvent.SpanKey ?? DBNull.Value);
            cmd.Parameters.AddWithValue("$causation_id", (object?)diagnosticsEvent.CausationId ?? DBNull.Value);
            cmd.Parameters.AddWithValue("$payload_json", json);
            cmd.Parameters.AddWithValue("$bytes", System.Text.Encoding.UTF8.GetByteCount(json));
            cmd.ExecuteNonQuery();

            EnforceBudgets(conn);
            RefreshStats(conn);
        }

        return ValueTask.CompletedTask;
    }

    public IReadOnlyList<DiagnosticsEvent> QueryEvents(
        string? connectionId,
        DateTimeOffset? since,
        string? namePrefix,
        int limit = 500)
    {
        using var conn = Open();
        using var cmd = conn.CreateCommand();
        var clauses = new List<string>();
        if (!string.IsNullOrWhiteSpace(connectionId))
        {
            clauses.Add("connection_id = $connection_id");
            cmd.Parameters.AddWithValue("$connection_id", connectionId);
        }

        if (since is not null)
        {
            clauses.Add("utc >= $since");
            cmd.Parameters.AddWithValue("$since", since.Value.ToString("O"));
        }

        if (!string.IsNullOrWhiteSpace(namePrefix))
        {
            clauses.Add("name LIKE $name_prefix");
            cmd.Parameters.AddWithValue("$name_prefix", namePrefix + "%");
        }

        var where = clauses.Count == 0 ? "" : "WHERE " + string.Join(" AND ", clauses);
        cmd.CommandText =
            $"""
            SELECT payload_json FROM diag_events
            {where}
            ORDER BY utc ASC
            LIMIT $limit;
            """;
        cmd.Parameters.AddWithValue("$limit", Math.Clamp(limit, 1, 5000));

        var results = new List<DiagnosticsEvent>();
        using var reader = cmd.ExecuteReader();
        while (reader.Read())
        {
            var evt = DeserializeEvent(reader.GetString(0));
            if (evt is not null) results.Add(evt);
        }

        return results;
    }

    /// <summary>
    /// Keyset-paginated timeline query for the Telemetry explorer. Ordered by (utc ASC, id ASC);
    /// the cursor encodes the last (utc, id) so paging is stable under concurrent inserts.
    /// Returns the page plus the total matching count for the [since, until] range.
    /// </summary>
    public DiagnosticsEventPage QueryEventsPaged(
        string? connectionId,
        DateTimeOffset? since,
        DateTimeOffset? until,
        string? namePrefix,
        int limit,
        string? cursorUtc,
        string? cursorId)
    {
        limit = Math.Clamp(limit, 1, 2000);
        using var conn = Open();

        long total;
        using (var countCmd = conn.CreateCommand())
        {
            var countClauses = new List<string>();
            AppendRangeClauses(countCmd, countClauses, connectionId, since, until, namePrefix);
            var countWhere = countClauses.Count == 0 ? "" : "WHERE " + string.Join(" AND ", countClauses);
            countCmd.CommandText = $"SELECT COUNT(*) FROM diag_events {countWhere};";
            total = Convert.ToInt64(countCmd.ExecuteScalar());
        }

        using var cmd = conn.CreateCommand();
        var clauses = new List<string>();
        AppendRangeClauses(cmd, clauses, connectionId, since, until, namePrefix);
        if (!string.IsNullOrEmpty(cursorUtc) && !string.IsNullOrEmpty(cursorId))
        {
            clauses.Add("(utc > $cursor_utc OR (utc = $cursor_utc AND id > $cursor_id))");
            cmd.Parameters.AddWithValue("$cursor_utc", cursorUtc);
            cmd.Parameters.AddWithValue("$cursor_id", cursorId);
        }

        var where = clauses.Count == 0 ? "" : "WHERE " + string.Join(" AND ", clauses);
        cmd.CommandText =
            $"""
            SELECT id, utc, payload_json FROM diag_events
            {where}
            ORDER BY utc ASC, id ASC
            LIMIT $limit;
            """;
        cmd.Parameters.AddWithValue("$limit", limit + 1);

        var rows = new List<(string Id, string Utc, string Json)>();
        using (var reader = cmd.ExecuteReader())
        {
            while (reader.Read())
                rows.Add((reader.GetString(0), reader.GetString(1), reader.GetString(2)));
        }

        string? nextCursor = null;
        if (rows.Count > limit)
        {
            var last = rows[limit - 1];
            nextCursor = EncodeCursor(last.Utc, last.Id);
            rows.RemoveRange(limit, rows.Count - limit);
        }

        var items = new List<DiagnosticsEvent>(rows.Count);
        foreach (var r in rows)
        {
            var evt = DeserializeEvent(r.Json);
            if (evt is not null) items.Add(evt);
        }

        return new DiagnosticsEventPage(items, total, nextCursor);
    }

    /// <summary>
    /// Downsampled range query for charting arbitrary time windows without transferring every
    /// sample: buckets rows by <paramref name="bucketSeconds"/> and keeps the last sample per
    /// bucket (representative last-value). Ordered by utc ASC. Bounded by <paramref name="maxScanRows"/>.
    /// </summary>
    public IReadOnlyList<DiagnosticsEvent> QueryEventsBucketed(
        string? connectionId,
        DateTimeOffset? since,
        DateTimeOffset? until,
        string? namePrefix,
        int bucketSeconds,
        int maxScanRows = 20000)
    {
        if (bucketSeconds <= 0) bucketSeconds = 1;
        using var conn = Open();
        using var cmd = conn.CreateCommand();
        var clauses = new List<string>();
        AppendRangeClauses(cmd, clauses, connectionId, since, until, namePrefix);
        var where = clauses.Count == 0 ? "" : "WHERE " + string.Join(" AND ", clauses);
        cmd.CommandText =
            $"""
            SELECT id, utc, payload_json FROM diag_events
            {where}
            ORDER BY utc ASC
            LIMIT $cap;
            """;
        cmd.Parameters.AddWithValue("$cap", Math.Clamp(maxScanRows, 1, 100_000));

        var bucketMs = (long)bucketSeconds * 1000;
        var order = new List<long>();
        var lastPerBucket = new Dictionary<long, DiagnosticsEvent>();
        using var reader = cmd.ExecuteReader();
        while (reader.Read())
        {
            var evt = DeserializeEvent(reader.GetString(2));
            if (evt is null) continue;
            var bucket = evt.Utc.ToUnixTimeMilliseconds() / bucketMs;
            if (!lastPerBucket.ContainsKey(bucket)) order.Add(bucket);
            lastPerBucket[bucket] = evt;
        }

        var result = new List<DiagnosticsEvent>(order.Count);
        foreach (var b in order) result.Add(lastPerBucket[b]);
        return result;
    }

    private static void AppendRangeClauses(
        SqliteCommand cmd,
        List<string> clauses,
        string? connectionId,
        DateTimeOffset? since,
        DateTimeOffset? until,
        string? namePrefix)
    {
        if (!string.IsNullOrWhiteSpace(connectionId))
        {
            clauses.Add("connection_id = $connection_id");
            cmd.Parameters.AddWithValue("$connection_id", connectionId);
        }

        if (since is not null)
        {
            clauses.Add("utc >= $since");
            cmd.Parameters.AddWithValue("$since", since.Value.ToString("O"));
        }

        if (until is not null)
        {
            clauses.Add("utc <= $until");
            cmd.Parameters.AddWithValue("$until", until.Value.ToString("O"));
        }

        if (!string.IsNullOrWhiteSpace(namePrefix))
        {
            clauses.Add("name LIKE $name_prefix");
            cmd.Parameters.AddWithValue("$name_prefix", namePrefix + "%");
        }
    }

    private static DiagnosticsEvent? DeserializeEvent(string json)
    {
        var dto = JsonSerializer.Deserialize<DiagnosticsEventDto>(json, JsonOptions);
        return dto?.ToEvent();
    }

    public static string EncodeCursor(string utc, string id)
        => Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes($"{utc}|{id}"));

    public static (string? Utc, string? Id) DecodeCursor(string? cursor)
    {
        if (string.IsNullOrWhiteSpace(cursor)) return (null, null);
        try
        {
            var raw = System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(cursor));
            var idx = raw.IndexOf('|');
            if (idx <= 0) return (null, null);
            return (raw[..idx], raw[(idx + 1)..]);
        }
        catch
        {
            return (null, null);
        }
    }

    public int PurgeExpired(DiagnosticsOptions options)
    {
        lock (_writeLock)
        {
            using var conn = Open();
            using var cmd = conn.CreateCommand();
            var cutoff = DateTimeOffset.UtcNow.AddHours(-Math.Max(1, options.Storage.TtlHours));
            cmd.CommandText = "DELETE FROM diag_events WHERE utc < $cutoff;";
            cmd.Parameters.AddWithValue("$cutoff", cutoff.ToString("O"));
            var purged = cmd.ExecuteNonQuery();
            EnforceBudgets(conn);
            RefreshStats(conn, DateTimeOffset.UtcNow);
            return purged;
        }
    }

    private void EnforceBudgets(SqliteConnection conn)
    {
        var options = _runtime.GetSnapshot().Options;
        using (var sizeCmd = conn.CreateCommand())
        {
            sizeCmd.CommandText = "SELECT COALESCE(SUM(bytes), 0) FROM diag_events;";
            var bytes = Convert.ToInt64(sizeCmd.ExecuteScalar());
            if (bytes > options.Storage.MaxBytes)
            {
                using var dropCmd = conn.CreateCommand();
                dropCmd.CommandText =
                    """
                    DELETE FROM diag_events WHERE id IN (
                        SELECT id FROM diag_events ORDER BY utc ASC LIMIT (
                            SELECT MAX(1, COUNT(*) / 10) FROM diag_events
                        )
                    );
                    """;
                var dropped = dropCmd.ExecuteNonQuery();
                _runtime.ReportOverflow();
                try
                {
                    _self.Value.StorageOverflow(options.Storage.MaxBytes, dropped, options.Storage.Overflow);
                }
                catch
                {
                    // Avoid recursive sink failure loops.
                }
            }
        }

        if (options.Storage.MaxEventsPerSession > 0)
        {
            using var perSession = conn.CreateCommand();
            perSession.CommandText =
                """
                DELETE FROM diag_events WHERE id IN (
                    SELECT id FROM (
                        SELECT id,
                               ROW_NUMBER() OVER (
                                   PARTITION BY connection_id ORDER BY utc DESC
                               ) AS rn
                        FROM diag_events
                        WHERE connection_id IS NOT NULL
                    ) t
                    WHERE rn > $max
                );
                """;
            perSession.Parameters.AddWithValue("$max", options.Storage.MaxEventsPerSession);
            try { perSession.ExecuteNonQuery(); }
            catch (SqliteException)
            {
                // Older SQLite without window functions — ignore per-session trim.
            }
        }
    }

    private void RefreshStats(SqliteConnection conn, DateTimeOffset? cleanupUtc = null)
    {
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT COUNT(*), COALESCE(SUM(bytes), 0) FROM diag_events;";
        using var reader = cmd.ExecuteReader();
        if (!reader.Read()) return;
        var count = reader.GetInt64(0);
        var bytes = reader.GetInt64(1);
        if (_runtime is DiagnosticsRuntime concrete)
            concrete.UpdateStorageStats(bytes, count, cleanupUtc);
    }

    private void EnsureSchema()
    {
        using var conn = Open();
        using var cmd = conn.CreateCommand();
        // Span columns (schema v2) are created here for fresh DBs and back-filled via idempotent
        // ALTER TABLE below for dev DBs created under v1.
        cmd.CommandText =
            """
            CREATE TABLE IF NOT EXISTS diag_events (
                id TEXT NOT NULL PRIMARY KEY,
                utc TEXT NOT NULL,
                domain TEXT NOT NULL,
                name TEXT NOT NULL,
                severity TEXT NOT NULL,
                correlation_id TEXT NULL,
                connection_id TEXT NULL,
                persisted_session_id TEXT NULL,
                sidecar_session_id TEXT NULL,
                seq INTEGER NOT NULL DEFAULT 0,
                span_id TEXT NULL,
                span_key TEXT NULL,
                causation_id TEXT NULL,
                payload_json TEXT NOT NULL,
                bytes INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS ix_diag_events_utc ON diag_events(utc);
            CREATE INDEX IF NOT EXISTS ix_diag_events_connection ON diag_events(connection_id, utc);
            CREATE INDEX IF NOT EXISTS ix_diag_events_name ON diag_events(name);
            """;
        cmd.ExecuteNonQuery();

        EnsureColumn(conn, "seq", "INTEGER NOT NULL DEFAULT 0");
        EnsureColumn(conn, "span_id", "TEXT NULL");
        EnsureColumn(conn, "span_key", "TEXT NULL");
        EnsureColumn(conn, "causation_id", "TEXT NULL");

        using var idx = conn.CreateCommand();
        idx.CommandText =
            """
            CREATE INDEX IF NOT EXISTS ix_diag_events_span ON diag_events(span_id);
            CREATE INDEX IF NOT EXISTS ix_diag_events_seq ON diag_events(seq);
            """;
        idx.ExecuteNonQuery();
    }

    private static void EnsureColumn(SqliteConnection conn, string column, string definition)
    {
        bool exists;
        using (var check = conn.CreateCommand())
        {
            check.CommandText = "SELECT COUNT(*) FROM pragma_table_info('diag_events') WHERE name = $col;";
            check.Parameters.AddWithValue("$col", column);
            exists = Convert.ToInt64(check.ExecuteScalar()) > 0;
        }

        if (exists)
            return;

        using var alter = conn.CreateCommand();
        alter.CommandText = $"ALTER TABLE diag_events ADD COLUMN {column} {definition};";
        alter.ExecuteNonQuery();
    }

    /// <summary>Highest persisted <c>Seq</c> (0 when empty). Seeds monotonic ordering after restart.</summary>
    public long QueryMaxSeq()
    {
        using var conn = Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT COALESCE(MAX(seq), 0) FROM diag_events;";
        return Convert.ToInt64(cmd.ExecuteScalar());
    }

    /// <summary>
    /// Open (unclosed) span events: a <c>span_id</c> that appears exactly once — its Open beat with
    /// no matching Close/Abandoned beat. Used for boot recovery.
    /// </summary>
    public IReadOnlyList<DiagnosticsEvent> QueryOpenSpanEvents()
    {
        using var conn = Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText =
            """
            SELECT payload_json FROM diag_events
            WHERE span_id IN (
                SELECT span_id FROM diag_events
                WHERE span_id IS NOT NULL
                GROUP BY span_id
                HAVING COUNT(*) = 1
            )
            ORDER BY seq ASC;
            """;

        var results = new List<DiagnosticsEvent>();
        using var reader = cmd.ExecuteReader();
        while (reader.Read())
        {
            var evt = DeserializeEvent(reader.GetString(0));
            if (evt is not null) results.Add(evt);
        }

        return results;
    }

    private SqliteConnection Open()
    {
        var conn = new SqliteConnection(_connectionString);
        conn.Open();
        return conn;
    }

    private sealed class DiagnosticsEventDto
    {
        public int DiagnosticsSchemaVersion { get; set; } = DiagnosticsSchema.Version;
        public string Id { get; set; } = "";
        public DateTimeOffset Utc { get; set; }
        public string Domain { get; set; } = "";
        public string Name { get; set; } = "";
        public string Severity { get; set; } = "Information";
        public string? CorrelationId { get; set; }
        public string? ConnectionId { get; set; }
        public string? PersistedSessionId { get; set; }
        public string? SidecarSessionId { get; set; }
        public long Seq { get; set; }
        public string? SpanId { get; set; }
        public string? SpanKey { get; set; }
        public string? CausationId { get; set; }
        public JsonElement? Payload { get; set; }

        public DiagnosticsEvent ToEvent() => new()
        {
            DiagnosticsSchemaVersion = DiagnosticsSchemaVersion,
            Id = Id,
            Utc = Utc,
            Domain = Enum.TryParse<DiagnosticsDomain>(Domain, true, out var d) ? d : DiagnosticsDomain.DiagnosticsSelf,
            Name = Name,
            Severity = Enum.TryParse<DiagnosticsSeverity>(Severity, true, out var s) ? s : DiagnosticsSeverity.Information,
            CorrelationId = CorrelationId,
            ConnectionId = ConnectionId,
            PersistedSessionId = PersistedSessionId,
            SidecarSessionId = SidecarSessionId,
            Seq = Seq,
            SpanId = SpanId,
            SpanKey = SpanKey,
            CausationId = CausationId,
            Payload = Payload,
        };
    }
}
