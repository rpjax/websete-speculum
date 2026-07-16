using Speculum.Api.Motor.Mapping;

namespace Speculum.Api.Edge;

public sealed class ProductionEdgeProfile : IEdgeProfile
{
    public void Materialize(EdgeMaterializationContext context)
    {
        // certificatesResolvers are Traefik *static* config — must not live under the dynamic
        // file provider (routers reference certResolver: le / le-dns-*).
        context.WriteTraefikFile("traefik.static.yml", TraefikYamlBuilder.BuildCertificatesYaml(context.Hosting));
        context.DeleteDynamicFile("certificates.yml");
        context.WriteDynamicFile("bootstrap.yml", TraefikYamlBuilder.BuildBootstrapRoutersYaml());

        var motorYaml = TraefikYamlBuilder.BuildMotorRoutersYaml(context.Hosting);
        if (motorYaml is null)
            context.DeleteDynamicFile("motor.yml");
        else
            context.WriteDynamicFile("motor.yml", motorYaml);

        WriteWildcardRouters(context);
        CleanupOrphanWildcardFiles(context);
        CleanupOrphanCloudflareEnvFiles(context);
    }

    private static void WriteWildcardRouters(EdgeMaterializationContext context)
    {
        foreach (var profile in context.Hosting.Profiles)
        {
            var id = HostingProfileResolver.SanitizeDomainForFile(profile.Domain);
            var fileName = $"wildcard-{id}.yml";
            var envFileName = $"cloudflare-{id}.env";

            if (!profile.SubdomainMirroringEnabled)
            {
                context.DeleteDynamicFile(fileName);
                context.DeleteTraefikFile(envFileName);
                continue;
            }

            var yaml = TraefikYamlBuilder.BuildWildcardRouterYaml(profile, context.Forwarding, context.CertsDir);
            if (yaml is null || profile.EdgeTls?.ApiToken is null)
            {
                context.DeleteDynamicFile(fileName);
                context.DeleteTraefikFile(envFileName);
                continue;
            }

            context.WriteTraefikFile(envFileName, TraefikYamlBuilder.BuildCloudflareEnvContent(profile.EdgeTls.ApiToken));
            context.WriteDynamicFile(fileName, yaml);
        }
    }

    private static void CleanupOrphanWildcardFiles(EdgeMaterializationContext context)
    {
        if (!Directory.Exists(context.DynamicDir)) return;

        var allowed = context.Hosting.Profiles
            .Where(p => p.SubdomainMirroringEnabled)
            .Select(p => $"wildcard-{HostingProfileResolver.SanitizeDomainForFile(p.Domain)}.yml")
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        foreach (var file in Directory.GetFiles(context.DynamicDir, "wildcard-*.yml"))
        {
            if (!allowed.Contains(Path.GetFileName(file)))
                TryDelete(file);
        }
    }

    private static void CleanupOrphanCloudflareEnvFiles(EdgeMaterializationContext context)
    {
        if (!Directory.Exists(context.TraefikRoot)) return;

        var allowed = context.Hosting.Profiles
            .Where(p => p.SubdomainMirroringEnabled)
            .Select(p => $"cloudflare-{HostingProfileResolver.SanitizeDomainForFile(p.Domain)}.env")
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        foreach (var file in Directory.GetFiles(context.TraefikRoot, "cloudflare-*.env"))
        {
            if (!allowed.Contains(Path.GetFileName(file)))
                TryDelete(file);
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
