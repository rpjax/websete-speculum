namespace Speculum.Lab;

/// <summary>
/// Configuração do lab. Única fonte de verdade — nada lê variável de ambiente
/// fora daqui.
/// </summary>
public sealed record LabOptions
{
    public required string Host { get; init; }

    public required int Port { get; init; }

    /// <summary>Endereço do plano de consumo do supervisor.</summary>
    public required Uri SupervisorUri { get; init; }

    /// <summary>
    /// Diretório com <c>client.html</c> e <c>client.js</c>.
    ///
    /// Aponta para o lab TypeScript existente. O cliente projetado NÃO é
    /// duplicado nem bifurcado: o lab .NET serve o mesmo artefato de produção,
    /// para que uma correção no cliente valha nos dois hosts no mesmo instante.
    /// </summary>
    public required string StaticDirectory { get; init; }

    /// <summary>Fixtures HTML do lab TypeScript. Opcional.</summary>
    public required string FixturesDirectory { get; init; }

    /// <summary>
    /// Executável do supervisor. O lab é o caller: é ele que sobe a sessão.
    /// </summary>
    public required string SupervisorExecutable { get; init; }

    /// <summary>Executável do Gecko, repassado ao supervisor.</summary>
    public required string BrowserExecutable { get; init; }

    public static LabOptions FromEnvironment()
    {
        var repoRoot = ResolveRepositoryRoot();

        return new LabOptions
        {
            Host = Environment.GetEnvironmentVariable("SPECULUM_LAB_HOST") ?? "127.0.0.1",
            Port = ReadPort("SPECULUM_LAB_PORT", 4077),
            SupervisorUri = new Uri(
                Environment.GetEnvironmentVariable("SPECULUM_SUPERVISOR_WS")
                ?? "ws://127.0.0.1:4100/session"),
            StaticDirectory =
                Environment.GetEnvironmentVariable("SPECULUM_LAB_STATIC")
                ?? Path.Combine(repoRoot, "sidecar", "browser", "mirror", "projection", "lab", "static"),
            FixturesDirectory =
                Environment.GetEnvironmentVariable("SPECULUM_LAB_FIXTURES")
                ?? Path.Combine(repoRoot, "sidecar", "browser", "mirror", "projection", "lab", "fixtures"),
            SupervisorExecutable =
                Environment.GetEnvironmentVariable("SPECULUM_SUPERVISOR_BIN")
                ?? Path.Combine(
                    repoRoot, "gecko-engine", "supervisor", "src", "Speculum.Supervisor",
                    "bin", "Debug", "net9.0", "speculum-supervisor"),
            BrowserExecutable =
                Environment.GetEnvironmentVariable("SPECULUM_BROWSER_BIN")
                ?? string.Empty,
        };
    }

    /// <summary>
    /// Sobe a árvore a partir do binário até achar a raiz do repositório. Sem
    /// caminho fixo no código: o lab roda igual do <c>dotnet run</c> e do publish.
    /// </summary>
    private static string ResolveRepositoryRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            if (Directory.Exists(Path.Combine(dir.FullName, "gecko-engine"))
                && Directory.Exists(Path.Combine(dir.FullName, "sidecar")))
            {
                return dir.FullName;
            }

            dir = dir.Parent;
        }

        return Directory.GetCurrentDirectory();
    }

    private static int ReadPort(string name, int fallback)
    {
        var raw = Environment.GetEnvironmentVariable(name);
        if (string.IsNullOrWhiteSpace(raw))
        {
            return fallback;
        }

        if (!int.TryParse(raw, out var port) || port is < 1 or > 65535)
        {
            throw new InvalidOperationException($"{name} inválido: '{raw}'");
        }

        return port;
    }
}
