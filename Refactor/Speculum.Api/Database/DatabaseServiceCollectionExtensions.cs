using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Speculum.Api.Database;

public static class DatabaseServiceCollectionExtensions
{
    public const int WalAutocheckpointPages = 1_000;

    /// <summary>
    /// Registers the unified Speculum SQLite store (<see cref="SpeculumDbContext"/>).
    /// </summary>
    public static IServiceCollection AddDatabase(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        services.AddOptions<DatabaseOptions>()
            .BindConfiguration(DatabaseOptions.SectionName)
            .ValidateOnStart();

        services.TryAddEnumerable(
            ServiceDescriptor.Singleton<IValidateOptions<DatabaseOptions>, DatabaseOptionsValidator>());

        services.TryAddSingleton<SqliteConnectionInterceptor>();

        if (!services.Any(d => d.ServiceType == typeof(SpeculumDbContext)))
        {
            services.AddDbContext<SpeculumDbContext>((sp, options) =>
            {
                var databaseOptions = sp.GetRequiredService<IOptionsMonitor<DatabaseOptions>>().CurrentValue;
                var path = ResolveDatabasePath(sp, databaseOptions.Path);

                var directory = Path.GetDirectoryName(path);
                if (!string.IsNullOrEmpty(directory))
                    Directory.CreateDirectory(directory);

                options.UseSqlite($"Data Source={path};Cache=Shared;Mode=ReadWriteCreate");
                options.AddInterceptors(sp.GetRequiredService<SqliteConnectionInterceptor>());
            });
        }

        return services;
    }

    /// <summary>
    /// Ensures the SQLite schema exists and enables WAL (database-scoped).
    /// Per-connection pragmas are applied by <see cref="SqliteConnectionInterceptor"/>.
    /// </summary>
    public static void EnsureDatabase(this IServiceProvider services)
    {
        ArgumentNullException.ThrowIfNull(services);

        using var scope = services.CreateScope();
        var sp = scope.ServiceProvider;
        var db = sp.GetRequiredService<SpeculumDbContext>();
        db.Database.EnsureCreated();
        EnsureScriptsTable(db);
        EnsureHostResourceAppliesTable(db);
        EnsureAuthTables(db);

        try
        {
            db.Database.ExecuteSqlRaw("PRAGMA journal_mode=WAL;");
            db.Database.ExecuteSqlRaw($"PRAGMA wal_autocheckpoint={WalAutocheckpointPages};");
        }
        catch (Exception ex)
        {
            sp.GetService<ILoggerFactory>()
                ?.CreateLogger("Speculum.Api.Database")
                .LogWarning(ex, "Failed to apply Speculum SQLite WAL settings.");
        }
    }

    /// <summary>
    /// EnsureCreated is a no-op when the SQLite file already exists — add tables introduced after first boot.
    /// </summary>
    private static void EnsureScriptsTable(SpeculumDbContext db)
    {
        db.Database.ExecuteSqlRaw(
            """
            CREATE TABLE IF NOT EXISTS scripts (
                id TEXT NOT NULL CONSTRAINT PK_scripts PRIMARY KEY,
                name TEXT NOT NULL,
                content TEXT NOT NULL,
                sha256 TEXT NOT NULL,
                size_bytes INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS IX_scripts_name ON scripts (name);
            CREATE INDEX IF NOT EXISTS IX_scripts_sha256 ON scripts (sha256);
            """);
    }

    private static void EnsureHostResourceAppliesTable(SpeculumDbContext db)
    {
        db.Database.ExecuteSqlRaw(
            """
            CREATE TABLE IF NOT EXISTS host_resource_applies (
                id INTEGER NOT NULL CONSTRAINT PK_host_resource_applies PRIMARY KEY,
                max_ram_bytes INTEGER NULL,
                reserve_percent REAL NOT NULL,
                reserve_min_bytes INTEGER NOT NULL,
                shm_min_bytes INTEGER NOT NULL,
                shm_max_percent_of_budget REAL NOT NULL,
                raise_ulimits INTEGER NOT NULL,
                nofile INTEGER NOT NULL,
                nproc INTEGER NOT NULL,
                budget_bytes INTEGER NOT NULL,
                reserve_bytes INTEGER NOT NULL,
                shm_target_bytes INTEGER NOT NULL,
                shm_applied_bytes INTEGER NOT NULL,
                host_memory_total_bytes INTEGER NOT NULL,
                host_cpu_count INTEGER NOT NULL,
                host_source TEXT NOT NULL,
                ulimits_raised INTEGER NOT NULL,
                warnings_json TEXT NOT NULL,
                applied_at TEXT NOT NULL
            );
            """);
    }

    private static void EnsureAuthTables(SpeculumDbContext db)
    {
        db.Database.ExecuteSqlRaw(
            """
            CREATE TABLE IF NOT EXISTS operator_users (
                id TEXT NOT NULL CONSTRAINT PK_operator_users PRIMARY KEY,
                username TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS IX_operator_users_username ON operator_users (username);

            CREATE TABLE IF NOT EXISTS auth_tokens (
                id TEXT NOT NULL CONSTRAINT PK_auth_tokens PRIMARY KEY,
                user_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                token_hash TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                revoked_at TEXT NULL,
                created_at TEXT NOT NULL,
                family_id TEXT NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS IX_auth_tokens_token_hash ON auth_tokens (token_hash);
            CREATE INDEX IF NOT EXISTS IX_auth_tokens_user_kind ON auth_tokens (user_id, kind);
            """);
    }

    private static string ResolveDatabasePath(IServiceProvider sp, string path)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(path);
        path = path.Trim();

        if (Path.IsPathRooted(path))
            return path;

        var root = sp.GetService<Microsoft.AspNetCore.Hosting.IWebHostEnvironment>()?.ContentRootPath
            ?? AppContext.BaseDirectory;
        return Path.GetFullPath(Path.Combine(root, path));
    }
}
