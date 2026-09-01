using System.Data;
using System.Data.Common;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using Speculum.Api.Database;

namespace Speculum.Api.Profiles.Retention;

/// <summary>
/// Storage usage for retention budget. Prefers SQLite allocated pages
/// (<c>page_count - freelist_count</c>) so deletes relieve pressure without VACUUM;
/// falls back to main+WAL file lengths, then journal row estimate.
/// </summary>
public static class RetentionStorageUsage
{
    public static async Task<long> MeasureBytesAsync(
        SpeculumDbContext db,
        IOptions<DatabaseOptions> database,
        IHostEnvironment environment,
        long journalEstimateBytes,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(database);
        ArgumentNullException.ThrowIfNull(environment);

        var allocated = await TryMeasureAllocatedSqliteBytesAsync(db, ct).ConfigureAwait(false);
        var walBytes = TryGetSiblingFileLength(database.Value.Path, environment.ContentRootPath, "-wal") ?? 0L;

        if (allocated is not null)
            return Math.Max(allocated.Value + walBytes, journalEstimateBytes);

        var files = TryGetDatabaseFilesLength(database.Value.Path, environment.ContentRootPath);
        if (files is not null)
            return Math.Max(files.Value, journalEstimateBytes);

        return journalEstimateBytes;
    }

    /// <summary>Sync fallback for hosts that only have file paths (no open DbContext).</summary>
    public static long MeasureBytes(
        IOptions<DatabaseOptions> database,
        IHostEnvironment environment,
        long journalEstimateBytes)
    {
        ArgumentNullException.ThrowIfNull(database);
        ArgumentNullException.ThrowIfNull(environment);

        var files = TryGetDatabaseFilesLength(database.Value.Path, environment.ContentRootPath);
        if (files is null)
            return journalEstimateBytes;

        return Math.Max(files.Value, journalEstimateBytes);
    }

    private static async Task<long?> TryMeasureAllocatedSqliteBytesAsync(
        SpeculumDbContext db,
        CancellationToken ct)
    {
        try
        {
            var connection = db.Database.GetDbConnection();
            var openedHere = connection.State != ConnectionState.Open;
            if (openedHere)
                await connection.OpenAsync(ct).ConfigureAwait(false);

            try
            {
                var pageSize = await ReadPragmaAsync(connection, "page_size", ct).ConfigureAwait(false);
                var pageCount = await ReadPragmaAsync(connection, "page_count", ct).ConfigureAwait(false);
                var freelist = await ReadPragmaAsync(connection, "freelist_count", ct).ConfigureAwait(false);
                var allocatedPages = Math.Max(0L, pageCount - freelist);
                return allocatedPages * pageSize;
            }
            finally
            {
                if (openedHere)
                    await connection.CloseAsync().ConfigureAwait(false);
            }
        }
        catch
        {
            return null;
        }
    }

    private static async Task<long> ReadPragmaAsync(DbConnection connection, string name, CancellationToken ct)
    {
        await using var cmd = connection.CreateCommand();
        cmd.CommandText = $"PRAGMA {name};";
        var value = await cmd.ExecuteScalarAsync(ct).ConfigureAwait(false);
        return Convert.ToInt64(value, System.Globalization.CultureInfo.InvariantCulture);
    }

    private static long? TryGetDatabaseFilesLength(string configuredPath, string contentRoot)
    {
        try
        {
            var path = ResolvePath(configuredPath, contentRoot);
            var main = new FileInfo(path);
            var total = main.Exists ? main.Length : 0L;
            total += TryGetSiblingFileLength(configuredPath, contentRoot, "-wal") ?? 0L;
            total += TryGetSiblingFileLength(configuredPath, contentRoot, "-shm") ?? 0L;
            return total;
        }
        catch
        {
            return null;
        }
    }

    private static long? TryGetSiblingFileLength(string configuredPath, string contentRoot, string suffix)
    {
        try
        {
            var path = ResolvePath(configuredPath, contentRoot) + suffix;
            var file = new FileInfo(path);
            return file.Exists ? file.Length : 0L;
        }
        catch
        {
            return null;
        }
    }

    private static string ResolvePath(string configuredPath, string contentRoot)
    {
        if (Path.IsPathRooted(configuredPath))
            return configuredPath;
        return Path.Combine(contentRoot, configuredPath);
    }
}
