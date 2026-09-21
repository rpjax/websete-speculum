namespace Speculum.Orchestrator;

/// <summary>
/// Parâmetros de lançamento do orquestrador. Nada aqui muda algoritmo —
/// só caminho, porta, teto de pares e o timer de caller caído (doc 15).
/// </summary>
public sealed record OrchestratorOptions
{
    public required int ListenPort { get; init; }

    public required string SupervisorExecutable { get; init; }

    public required string BrowserExecutable { get; init; }

    public required string DataRoot { get; init; }

    public required int MaxPairs { get; init; }

    public required int ConsumerPortStart { get; init; }

    public required TimeSpan DetachTimeout { get; init; }

    public static OrchestratorOptions FromEnvironment()
    {
        var supervisor = Environment.GetEnvironmentVariable("SPECULUM_SUPERVISOR_BIN");
        if (string.IsNullOrWhiteSpace(supervisor))
        {
            throw new InvalidOperationException(
                "SPECULUM_SUPERVISOR_BIN não definida. O orquestrador é dono dos pares.");
        }

        var browser = Environment.GetEnvironmentVariable("SPECULUM_BROWSER_BIN");
        if (string.IsNullOrWhiteSpace(browser))
        {
            throw new InvalidOperationException(
                "SPECULUM_BROWSER_BIN não definida. Aponte para dist/bin/firefox.");
        }

        return new OrchestratorOptions
        {
            ListenPort = ReadInt("SPECULUM_ORCHESTRATOR_PORT", 4100),
            SupervisorExecutable = supervisor,
            BrowserExecutable = browser,
            DataRoot = Environment.GetEnvironmentVariable("SPECULUM_ORCHESTRATOR_DATA")
                ?? "/var/lib/speculum/sessions",
            MaxPairs = ReadInt("SPECULUM_ORCHESTRATOR_MAX_PAIRS", 8),
            ConsumerPortStart = ReadInt("SPECULUM_ORCHESTRATOR_PORT_START", 4200),
            DetachTimeout = TimeSpan.FromSeconds(ReadInt("SPECULUM_ORCHESTRATOR_DETACH_SECONDS", 3)),
        };
    }

    private static int ReadInt(string name, int fallback)
    {
        var raw = Environment.GetEnvironmentVariable(name);
        if (string.IsNullOrWhiteSpace(raw))
        {
            return fallback;
        }

        if (!int.TryParse(raw, out var value) || value < 1)
        {
            throw new InvalidOperationException($"{name} inválido: '{raw}'");
        }

        return value;
    }
}
