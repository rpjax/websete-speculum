namespace Speculum.Supervisor;

/// <summary>
/// Configuração do supervisor. Única fonte de verdade — nada lê variável de
/// ambiente fora daqui.
///
/// Não existe opção que mude COMPORTAMENTO. Só existe parâmetro de lançamento.
/// Bandeira de modo faria o lab exercitar um supervisor diferente do de produção,
/// e um lab que testa outro binário é falso positivo.
/// </summary>
public sealed record SupervisorOptions
{
    /// <summary>Unix domain socket onde o browser filho se conecta.</summary>
    public required string BrowserSocketPath { get; init; }

    /// <summary>Executável do Gecko. O supervisor é dono desse processo.</summary>
    public required string BrowserExecutable { get; init; }

    /// <summary>Perfil do browser. Vazio = perfil temporário criado por execução.</summary>
    public required string? BrowserProfile { get; init; }

    /// <summary>URL inicial.</summary>
    public required string BrowserUrl { get; init; }

    /// <summary>Sem display, como na captura do devpath.</summary>
    public required bool BrowserHeadless { get; init; }

    /// <summary>Viewport do contexto pedido no ContextCreate.</summary>
    public required int ViewportWidth { get; init; }

    public required int ViewportHeight { get; init; }

    /// <summary>Porta do plano de consumo.</summary>
    public required int ConsumerPort { get; init; }

    /// <summary>
    /// Launch param: Kind 0x05 no Gecko. Default off se ausente (produto quieto).
    /// </summary>
    public required bool CapEvents { get; init; }

    /// <summary>Launch param: buildMs. Só faz efeito com CapEvents.</summary>
    public required bool CapMetrics { get; init; }

    public static SupervisorOptions FromEnvironment()
    {
        var executable = Environment.GetEnvironmentVariable("SPECULUM_BROWSER_BIN");
        if (string.IsNullOrWhiteSpace(executable))
        {
            throw new InvalidOperationException(
                "SPECULUM_BROWSER_BIN não definida. O supervisor é dono do browser: "
                + "aponte para <objdir>/dist/bin/firefox.");
        }

        return new SupervisorOptions
        {
            BrowserSocketPath =
                Environment.GetEnvironmentVariable("SPECULUM_BROWSER_SOCKET")
                ?? "/tmp/speculum-browser.sock",
            BrowserExecutable = executable,
            BrowserProfile = Environment.GetEnvironmentVariable("SPECULUM_BROWSER_PROFILE"),
            BrowserUrl = Environment.GetEnvironmentVariable("SPECULUM_BROWSER_URL") ?? "about:blank",
            BrowserHeadless = Environment.GetEnvironmentVariable("SPECULUM_BROWSER_HEADLESS") != "0",
            ViewportWidth = ReadPort("SPECULUM_VIEWPORT_WIDTH", 1280),
            ViewportHeight = ReadPort("SPECULUM_VIEWPORT_HEIGHT", 800),
            ConsumerPort = ReadPort("SPECULUM_SUPERVISOR_PORT", 4100),
            CapEvents = EnvFlagOn("SPECULUM_CAP_EVENTS"),
            CapMetrics = EnvFlagOn("SPECULUM_CAP_METRICS"),
        };
    }

    private static bool EnvFlagOn(string name)
    {
        var raw = Environment.GetEnvironmentVariable(name);
        return !string.IsNullOrEmpty(raw) && raw[0] != '0';
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
