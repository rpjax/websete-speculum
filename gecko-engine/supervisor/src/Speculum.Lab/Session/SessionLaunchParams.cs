namespace Speculum.Lab.Session;

/// <summary>Parâmetros de lançamento de uma sessão lab → supervisor → Gecko.</summary>
public sealed record SessionLaunchParams
{
    public required string Url { get; init; }

    public int ViewportWidth { get; init; }

    public int ViewportHeight { get; init; }

    /// <summary>SPECULUM_CAP_EVENTS — Kind 0x05.</summary>
    public bool CapEvents { get; init; }

    /// <summary>SPECULUM_CAP_METRICS — buildMs (só com events).</summary>
    public bool CapMetrics { get; init; }

    /// <summary>Diretório do dossier desta sessão (pode estar vazio até criar).</summary>
    public string DossierDir { get; init; } = "";
}
