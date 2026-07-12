using Speculum.Api.Config.Bootstrap;
using Speculum.Api.Config.Store;

namespace Speculum.Api.Hosting;

public sealed class EdgeTlsWriter : IHostedService
{
    private readonly IServiceProvider _services;
    private readonly BootstrapConfig _bootstrap;
    private readonly ILogger<EdgeTlsWriter> _logger;
    private readonly string _traefikDir;

    public EdgeTlsWriter(
        IServiceProvider services,
        BootstrapConfig bootstrap,
        IConfiguration configuration,
        ILogger<EdgeTlsWriter> logger)
    {
        _services  = services;
        _bootstrap = bootstrap;
        _logger    = logger;
        _traefikDir = configuration["Traefik:DynamicDir"]?.Trim()
                      ?? Path.Combine(Path.GetDirectoryName(bootstrap.DatabasePath) ?? "/data", "traefik", "dynamic");
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        Apply();
        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    public void Apply()
    {
        var store = _services.GetRequiredService<ISpeculumConfigStore>();

        try
        {
            Directory.CreateDirectory(_traefikDir);
            var parentDir = Directory.GetParent(_traefikDir)?.FullName ?? _traefikDir;
            Directory.CreateDirectory(parentDir);

            var envPath      = Path.Combine(parentDir, "cloudflare.env");
            var wildcardPath = Path.Combine(_traefikDir, "subdomain-wildcard.yml");

            if (!store.IsSubdomainMirroringOperational)
            {
                TryDelete(envPath);
                TryDelete(wildcardPath);
                _logger.LogInformation("Subdomain mirroring inactive — removed Traefik wildcard config.");
                return;
            }

            var edgeTls = store.Current.SubdomainMirroring.EdgeTls!;
            File.WriteAllText(envPath, $"CF_DNS_API_TOKEN={edgeTls.ApiToken}\n");

            var motorDomain = _bootstrap.MotorPublicDomain.Trim().Replace(".", "\\.");
            var yaml = $"""
                http:
                  routers:
                    speculum-web-wildcard:
                      rule: "HostRegexp(`^[a-z0-9-]+\\.{motorDomain}$`)"
                      entryPoints:
                        - websecure
                      tls:
                        certResolver: le-dns
                      service: speculum-web@docker
                """;

            File.WriteAllText(wildcardPath, yaml);
            _logger.LogInformation("Subdomain mirroring active — wrote Traefik wildcard config.");
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to write Traefik EdgeTls configuration.");
        }
    }

    private static void TryDelete(string path)
    {
        try
        {
            if (File.Exists(path)) File.Delete(path);
        }
        catch { /* best-effort */ }
    }
}
