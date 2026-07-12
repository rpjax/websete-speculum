using Speculum.Api.Config.Bootstrap;
using Speculum.Api.Config.Runtime;
using Speculum.Api.Config.Store;

namespace Speculum.Api.Hosting;

public sealed class EdgeWriter : IHostedService
{
    private readonly IServiceProvider _services;
    private readonly BootstrapConfig _bootstrap;
    private readonly TraefikReloader _reloader;
    private readonly ILogger<EdgeWriter> _logger;
    private readonly string _traefikRoot;
    private readonly string _dynamicDir;
    private readonly string _certsDir;

    public EdgeWriter(
        IServiceProvider services,
        BootstrapConfig bootstrap,
        TraefikReloader reloader,
        IConfiguration configuration,
        ILogger<EdgeWriter> logger)
    {
        _services   = services;
        _bootstrap  = bootstrap;
        _reloader   = reloader;
        _logger     = logger;
        _traefikRoot = configuration["Traefik:Root"]?.Trim()
                       ?? Path.Combine(Path.GetDirectoryName(bootstrap.DatabasePath) ?? "/data", "traefik");
        _dynamicDir = configuration["Traefik:DynamicDir"]?.Trim()
                      ?? Path.Combine(_traefikRoot, "dynamic");
        _certsDir   = Path.Combine(_traefikRoot, "certs");
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
            Directory.CreateDirectory(_dynamicDir);
            Directory.CreateDirectory(_certsDir);
            Directory.CreateDirectory(_traefikRoot);

            var hosting   = store.Current.Hosting;
            var forwarding = store.Current.Forwarding;

            WriteStaticConfig(hosting);
            WriteBootstrapRouter();
            WriteMotorRouters(hosting);
            WriteWildcardRouters(hosting, forwarding);
            CleanupOrphanWildcardFiles(hosting);
            CleanupOrphanCloudflareEnvFiles(hosting);

            _ = _reloader.ReloadAsync();
            _logger.LogInformation("Edge configuration materialized under {Root}.", _traefikRoot);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to write Traefik edge configuration.");
        }
    }

    private void WriteStaticConfig(HostingOptions hosting)
    {
        var defaultEmail = string.IsNullOrWhiteSpace(hosting.AcmeEmail)
            ? "admin@example.com"
            : hosting.AcmeEmail.Trim();
        var resolverLines = new List<string>
        {
            "  le:",
            "    acme:",
            $"      email: {YamlQuote(defaultEmail)}",
            "      storage: /letsencrypt/acme.json",
            "      httpChallenge:",
            "        entryPoint: web",
        };

        foreach (var profile in hosting.Profiles)
        {
            if (!profile.SubdomainMirroringEnabled)
                continue;

            var id = HostingProfileResolver.SanitizeDomainForFile(profile.Domain);
            var email = HostingProfileResolver.ResolveAcmeEmail(profile, hosting);
            resolverLines.Add($"  le-dns-{id}:");
            resolverLines.Add("    acme:");
            resolverLines.Add($"      email: {YamlQuote(email)}");
            resolverLines.Add($"      storage: /letsencrypt/acme-dns-{id}.json");
            resolverLines.Add("      dnsChallenge:");
            resolverLines.Add("        provider: cloudflare");
            resolverLines.Add("        resolvers:");
            resolverLines.Add("          - \"1.1.1.1:53\"");
            resolverLines.Add("          - \"8.8.8.8:53\"");
        }

        var yaml = $"""
            certificatesResolvers:
            {string.Join('\n', resolverLines)}
            """;

        File.WriteAllText(Path.Combine(_traefikRoot, "traefik.static.yml"), yaml);
    }

    private void WriteBootstrapRouter()
    {
        var yaml = """
            http:
              routers:
                speculum-bootstrap:
                  rule: "PathPrefix(`/`)"
                  entryPoints:
                    - web
                  priority: 1
                  service: speculum-web@docker
                speculum-bootstrap-api:
                  rule: "PathPrefix(`/api`) || PathPrefix(`/vhub`) || PathPrefix(`/health`) || PathPrefix(`/ready`) || PathPrefix(`/openapi`)"
                  entryPoints:
                    - web
                  priority: 100
                  service: speculum-api@docker
            """;

        File.WriteAllText(Path.Combine(_dynamicDir, "bootstrap.yml"), yaml);
    }

    private void WriteMotorRouters(HostingOptions hosting)
    {
        if (hosting.Profiles.Count == 0)
        {
            TryDelete(Path.Combine(_dynamicDir, "motor.yml"));
            return;
        }

        var hostRules = new List<string>();
        foreach (var p in hosting.Profiles)
        {
            var d = p.Domain.Trim();
            hostRules.Add($"Host(`{d}`)");
            hostRules.Add($"Host(`www.{d}`)");
        }

        var hostExpr = string.Join(" || ", hostRules);
        var yaml = $"""
            http:
              routers:
                speculum-api:
                  rule: "({hostExpr}) && (PathPrefix(`/api`) || PathPrefix(`/vhub`) || PathPrefix(`/health`) || PathPrefix(`/ready`) || PathPrefix(`/openapi`))"
                  entryPoints:
                    - websecure
                  tls:
                    certResolver: le
                  priority: 100
                  service: speculum-api@docker
                speculum-web:
                  rule: "{hostExpr}"
                  entryPoints:
                    - websecure
                  tls:
                    certResolver: le
                  priority: 10
                  service: speculum-web@docker
                speculum-http-redirect:
                  rule: "({hostExpr}) && !PathPrefix(`/.well-known/acme-challenge/`)"
                  entryPoints:
                    - web
                  middlewares:
                    - speculum-acme
                  priority: 50
                  service: speculum-web@docker
              middlewares:
                speculum-acme:
                  redirectScheme:
                    scheme: https
                    permanent: true
            """;

        File.WriteAllText(Path.Combine(_dynamicDir, "motor.yml"), yaml);
    }

    private void WriteWildcardRouters(HostingOptions hosting, ForwardingOptions? forwarding)
    {
        foreach (var profile in hosting.Profiles)
        {
            var fileName = $"wildcard-{HostingProfileResolver.SanitizeDomainForFile(profile.Domain)}.yml";
            var path = Path.Combine(_dynamicDir, fileName);
            var envPath = Path.Combine(_traefikRoot, $"cloudflare-{HostingProfileResolver.SanitizeDomainForFile(profile.Domain)}.env");

            if (!profile.SubdomainMirroringEnabled)
            {
                TryDelete(path);
                TryDelete(envPath);
                continue;
            }

            var (op, _) = HostingEvaluator.EvaluateProfile(profile, forwarding);
            if (!op || profile.EdgeTls?.ApiToken is null)
            {
                TryDelete(path);
                TryDelete(envPath);
                continue;
            }

            File.WriteAllText(envPath, $"CF_DNS_API_TOKEN={profile.EdgeTls.ApiToken}\n");

            var escaped = profile.Domain.Trim().Replace(".", "\\.");
            var id = HostingProfileResolver.SanitizeDomainForFile(profile.Domain);
            var certFile = Path.Combine(_certsDir, $"wildcard-{id}.crt");
            var keyFile  = Path.Combine(_certsDir, $"wildcard-{id}.key");

            // Exclude apex and www — those are handled by motor.yml (HTTP-01 / le resolver).
            var hostRule = $"HostRegexp(`^(?!www\\\\.)[a-z0-9-]+\\\\.{escaped}$`)";
            var apiPaths = "PathPrefix(`/api`) || PathPrefix(`/vhub`) || PathPrefix(`/health`) || PathPrefix(`/ready`) || PathPrefix(`/openapi`)";

            string tlsBlock;
            if (File.Exists(certFile) && File.Exists(keyFile))
            {
                tlsBlock = $"""
                      tls:
                        certificates:
                          - certFile: {YamlQuote(certFile)}
                            keyFile: {YamlQuote(keyFile)}
                    """;
            }
            else
            {
                tlsBlock = $"""
                      tls:
                        certResolver: le-dns-{id}
                    """;
            }

            var yaml = $"""
                http:
                  routers:
                    speculum-api-wildcard-{id}:
                      rule: "{hostRule} && ({apiPaths})"
                      entryPoints:
                        - websecure
                      priority: 100
                {tlsBlock}
                      service: speculum-api@docker
                    speculum-web-wildcard-{id}:
                      rule: "{hostRule}"
                      entryPoints:
                        - websecure
                      priority: 10
                {tlsBlock}
                      service: speculum-web@docker
                    speculum-http-wildcard-{id}:
                      rule: "{hostRule} && !PathPrefix(`/.well-known/acme-challenge/`)"
                      entryPoints:
                        - web
                      middlewares:
                        - speculum-acme
                      priority: 50
                      service: speculum-web@docker
                """;

            File.WriteAllText(path, yaml);
        }
    }

    private void CleanupOrphanWildcardFiles(HostingOptions hosting)
    {
        if (!Directory.Exists(_dynamicDir)) return;

        var allowed = hosting.Profiles
            .Where(p => p.SubdomainMirroringEnabled)
            .Select(p => $"wildcard-{HostingProfileResolver.SanitizeDomainForFile(p.Domain)}.yml")
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        foreach (var file in Directory.GetFiles(_dynamicDir, "wildcard-*.yml"))
        {
            if (!allowed.Contains(Path.GetFileName(file)))
                TryDelete(file);
        }
    }

    private void CleanupOrphanCloudflareEnvFiles(HostingOptions hosting)
    {
        if (!Directory.Exists(_traefikRoot)) return;

        var allowed = hosting.Profiles
            .Where(p => p.SubdomainMirroringEnabled)
            .Select(p => $"cloudflare-{HostingProfileResolver.SanitizeDomainForFile(p.Domain)}.env")
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        foreach (var file in Directory.GetFiles(_traefikRoot, "cloudflare-*.env"))
        {
            if (!allowed.Contains(Path.GetFileName(file)))
                TryDelete(file);
        }
    }

    private static string YamlQuote(string value)
        => "\"" + value.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";

    private static void TryDelete(string path)
    {
        try
        {
            if (File.Exists(path)) File.Delete(path);
        }
        catch { /* best-effort */ }
    }
}
