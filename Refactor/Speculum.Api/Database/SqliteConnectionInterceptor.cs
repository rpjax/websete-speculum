using System.Data.Common;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Options;

namespace Speculum.Api.Database;

/// <summary>
/// Applies per-connection SQLite pragmas (FK enforcement is connection-scoped).
/// </summary>
public sealed class SqliteConnectionInterceptor : DbConnectionInterceptor
{
    private readonly IOptionsMonitor<DatabaseOptions> _options;

    public SqliteConnectionInterceptor(IOptionsMonitor<DatabaseOptions> options)
    {
        _options = options ?? throw new ArgumentNullException(nameof(options));
    }

    public override void ConnectionOpened(DbConnection connection, ConnectionEndEventData eventData)
    {
        ApplyPragmas(connection);
        base.ConnectionOpened(connection, eventData);
    }

    public override async Task ConnectionOpenedAsync(
        DbConnection connection,
        ConnectionEndEventData eventData,
        CancellationToken cancellationToken = default)
    {
        await ApplyPragmasAsync(connection, cancellationToken).ConfigureAwait(false);
        await base.ConnectionOpenedAsync(connection, eventData, cancellationToken).ConfigureAwait(false);
    }

    private void ApplyPragmas(DbConnection connection)
    {
        var busy = Math.Max(0, _options.CurrentValue.SqliteBusyTimeoutMs);
        using var cmd = connection.CreateCommand();
        cmd.CommandText =
            $"PRAGMA foreign_keys=ON; PRAGMA busy_timeout={busy}; PRAGMA synchronous=NORMAL;";
        cmd.ExecuteNonQuery();
    }

    private async Task ApplyPragmasAsync(DbConnection connection, CancellationToken cancellationToken)
    {
        var busy = Math.Max(0, _options.CurrentValue.SqliteBusyTimeoutMs);
        await using var cmd = connection.CreateCommand();
        cmd.CommandText =
            $"PRAGMA foreign_keys=ON; PRAGMA busy_timeout={busy}; PRAGMA synchronous=NORMAL;";
        await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }
}
