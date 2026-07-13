using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;

namespace Speculum.Api.Tests;

public sealed class SpeculumWebApplicationFactory : WebApplicationFactory<Program>
{
    internal readonly string DbPath = Path.Combine(
        Path.GetTempPath(), $"speculum-smoke-{Guid.NewGuid():N}.db");

    private string? _prevHttpAddress;
    private string? _prevDatabasePath;
    private string? _prevSidecarBaseUrl;
    private string? _prevCors;
    private string? _prevAdminKey;

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Development");

        _prevHttpAddress = Environment.GetEnvironmentVariable("HttpAddress");
        _prevDatabasePath = Environment.GetEnvironmentVariable("Database__Path");
        _prevSidecarBaseUrl = Environment.GetEnvironmentVariable("Sidecar__BaseUrl");
        _prevCors = Environment.GetEnvironmentVariable("Cors__AllowedOrigins");
        _prevAdminKey = Environment.GetEnvironmentVariable("ADMIN_BOOTSTRAP_KEY");

        // BootstrapConfig.Load reads IConfiguration; env vars often win over
        // in-memory keys, so pin an isolated empty database for smoke tests.
        Environment.SetEnvironmentVariable("HttpAddress", "127.0.0.1:0");
        Environment.SetEnvironmentVariable("Database__Path", DbPath);
        Environment.SetEnvironmentVariable("Sidecar__BaseUrl", "ws://127.0.0.1:39999");
        Environment.SetEnvironmentVariable("Cors__AllowedOrigins", "http://localhost:5173");
        Environment.SetEnvironmentVariable("ADMIN_BOOTSTRAP_KEY", "smoke-test-admin-key");

        builder.ConfigureAppConfiguration((_, config) =>
        {
            config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["HttpAddress"]            = "127.0.0.1:0",
                ["Database:Path"]          = DbPath,
                ["Sidecar:BaseUrl"]        = "ws://127.0.0.1:39999",
                ["Cors:AllowedOrigins"]    = "http://localhost:5173",
                ["ASPNETCORE_ENVIRONMENT"] = "Development",
            });
        });
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            Restore("HttpAddress", _prevHttpAddress);
            Restore("Database__Path", _prevDatabasePath);
            Restore("Sidecar__BaseUrl", _prevSidecarBaseUrl);
            Restore("Cors__AllowedOrigins", _prevCors);
            Restore("ADMIN_BOOTSTRAP_KEY", _prevAdminKey);

            try
            {
                if (File.Exists(DbPath))
                    File.Delete(DbPath);
                var diag = Path.Combine(
                    Path.GetDirectoryName(DbPath) ?? ".",
                    Path.GetFileNameWithoutExtension(DbPath) + ".diagnostics.db");
                if (File.Exists(diag))
                    File.Delete(diag);
            }
            catch { /* best-effort */ }
        }

        base.Dispose(disposing);
    }

    private static void Restore(string name, string? previous)
        => Environment.SetEnvironmentVariable(name, previous);
}
