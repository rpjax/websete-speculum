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
