namespace Speculum.Api.Edge;

public sealed class DevelopmentEdgeProfile : IEdgeProfile
{
    public void Materialize(EdgeMaterializationContext context)
    {
        context.WriteDynamicFile("bootstrap.yml", TraefikYamlBuilder.BuildBootstrapRoutersYaml());
        context.DeleteDynamicFile("motor.yml");
        context.DeleteDynamicFile("certificates.yml");
        context.DeleteTraefikFile("traefik.static.yml");

        CleanupOrphanWildcardFiles(context);
        CleanupOrphanCloudflareEnvFiles(context);
    }

    private static void CleanupOrphanWildcardFiles(EdgeMaterializationContext context)
    {
        if (!Directory.Exists(context.DynamicDir)) return;

        foreach (var file in Directory.GetFiles(context.DynamicDir, "wildcard-*.yml"))
            TryDelete(file);
    }

    private static void CleanupOrphanCloudflareEnvFiles(EdgeMaterializationContext context)
    {
        if (!Directory.Exists(context.TraefikRoot)) return;

        foreach (var file in Directory.GetFiles(context.TraefikRoot, "cloudflare-*.env"))
            TryDelete(file);
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
