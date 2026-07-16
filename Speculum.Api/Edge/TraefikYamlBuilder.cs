using Speculum.Api.Config.Application;
using Speculum.Api.Config.Runtime;
using Speculum.Api.Motor.Mapping;

namespace Speculum.Api.Edge;

public static class TraefikYamlBuilder
{
    public static string BuildCertificatesYaml(HostingOptions hosting)
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

        // Full static document: Traefik --configfile replaces CLI static flags.
        // EntryPoints + providers must live here with certificatesResolvers.
        return $"""
            api:
              dashboard: false
            entryPoints:
              web:
                address: ":80"
              websecure:
                address: ":443"
                http:
                  tls: {"{}"}
            providers:
              docker:
                exposedByDefault: false
                network: speculum
              file:
                directory: /data/traefik/dynamic
                watch: true
            certificatesResolvers:
            {string.Join('\n', resolverLines)}
            """;
    }

    public static string BuildBootstrapRoutersYaml()
        => """
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

    public static string? BuildMotorRoutersYaml(HostingOptions hosting)
    {
        if (hosting.Profiles.Count == 0)
            return null;

        var hostRules = new List<string>();
        foreach (var p in hosting.Profiles)
        {
            var d = p.Domain.Trim();
            hostRules.Add($"Host(`{d}`)");
            hostRules.Add($"Host(`www.{d}`)");
        }

        var hostExpr = string.Join(" || ", hostRules);
        return $"""
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
    }

    public static string? BuildWildcardRouterYaml(
        HostingProfileOptions profile,
        ForwardingOptions? forwarding,
        string certsDir)
    {
        var (operational, _) = HostingEvaluator.EvaluateProfile(profile, forwarding);
        if (!profile.SubdomainMirroringEnabled || !operational || profile.EdgeTls?.ApiToken is null)
            return null;

        var escaped = profile.Domain.Trim().Replace(".", "\\.");
        var id = HostingProfileResolver.SanitizeDomainForFile(profile.Domain);
        var certFile = Path.Combine(certsDir, $"wildcard-{id}.crt");
        var keyFile  = Path.Combine(certsDir, $"wildcard-{id}.key");

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

        return $"""
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
    }

    public static string BuildCloudflareEnvContent(string apiToken)
        => $"CF_DNS_API_TOKEN={apiToken}\n";

    private static string YamlQuote(string value)
        => "\"" + value.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
}
