using Microsoft.Data.Sqlite;
using Speculum.Api.Diagnostics.Abstractions;
using Speculum.Api.Diagnostics.Configuration;
using Speculum.Api.Diagnostics.Emitters;
using System.Text.Json;

namespace Speculum.Api.Diagnostics.Pipeline;

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
                    connection_id, persisted_session_id, sidecar_session_id, payload_json, bytes
                ) VALUES (
                    $id, $utc, $domain, $name, $severity, $correlation_id,
                    $connection_id, $persisted_session_id, $sidecar_session_id, $payload_json, $bytes
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
            var json = reader.GetString(0);
            var evt = JsonSerializer.Deserialize<DiagnosticsEventDto>(json, JsonOptions);
            if (evt is null) continue;
            results.Add(evt.ToEvent());
        }

        return results;
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
                payload_json TEXT NOT NULL,
                bytes INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS ix_diag_events_utc ON diag_events(utc);
            CREATE INDEX IF NOT EXISTS ix_diag_events_connection ON diag_events(connection_id, utc);
            CREATE INDEX IF NOT EXISTS ix_diag_events_name ON diag_events(name);
            """;
        cmd.ExecuteNonQuery();
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
            Payload = Payload,
        };
    }
}
