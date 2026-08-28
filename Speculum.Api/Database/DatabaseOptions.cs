namespace Speculum.Api.Database;

/// <summary>
/// Tunables for the unified Speculum SQLite store.
/// Bound from configuration section <see cref="SectionName"/> (env: <c>Database__Path</c>).
/// </summary>
public sealed class DatabaseOptions
{
    public const string SectionName = "Database";

    public const string DefaultPath = "data/speculum.db";
    public const int DefaultSqliteBusyTimeoutMs = 5_000;

    /// <summary>SQLite database file path (relative paths resolve under the content root).</summary>
    public string Path { get; set; } = DefaultPath;

    /// <summary>SQLite busy_timeout applied on every connection open (milliseconds).</summary>
    public int SqliteBusyTimeoutMs { get; set; } = DefaultSqliteBusyTimeoutMs;
}
