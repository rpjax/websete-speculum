using Speculum.Api.Config.Runtime;

namespace Speculum.Api.Edge;

public interface IEdgeProfile
{
    void Materialize(EdgeMaterializationContext context);
}

public sealed class EdgeMaterializationContext
{
    public required string DynamicDir { get; init; }
    public required string TraefikRoot { get; init; }
    public required string CertsDir { get; init; }
    public required HostingOptions Hosting { get; init; }
    public required ForwardingOptions? Forwarding { get; init; }

    public void WriteDynamicFile(string fileName, string content)
        => File.WriteAllText(Path.Combine(DynamicDir, fileName), content);

    public void WriteTraefikFile(string fileName, string content)
        => File.WriteAllText(Path.Combine(TraefikRoot, fileName), content);

    public void DeleteDynamicFile(string fileName)
        => TryDelete(Path.Combine(DynamicDir, fileName));

    public void DeleteTraefikFile(string fileName)
        => TryDelete(Path.Combine(TraefikRoot, fileName));

    private static void TryDelete(string path)
    {
        try
        {
            if (File.Exists(path)) File.Delete(path);
        }
        catch { /* best-effort */ }
    }
}
