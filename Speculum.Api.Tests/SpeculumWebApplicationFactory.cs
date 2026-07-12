using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;

namespace Speculum.Api.Tests;

public sealed class SpeculumWebApplicationFactory : WebApplicationFactory<Program>
{
    internal static readonly string DbPath = Path.Combine(
        Path.GetTempPath(), $"speculum-smoke-{Guid.NewGuid():N}.db");

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.ConfigureAppConfiguration((_, config) =>
        {
            config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["HttpAddress"]         = "127.0.0.1:18080",
                ["Database:Path"]       = DbPath,
                ["Sidecar:BaseUrl"]     = "ws://127.0.0.1:39999",
                ["Cors:AllowedOrigins"] = "http://localhost:5173",
                ["Motor:PublicDomain"]  = "speculum.localhost",
            });
        });
    }
}
