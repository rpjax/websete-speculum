namespace Speculum.Api.Motor.Sidecar;

/// <summary>
/// Configurações imutáveis de infraestrutura do <see cref="SidecarBrowserClient"/>.
/// </summary>
public sealed record SidecarBrowserClientOptions
{
    /// <summary>URL base do sidecar Node.js (ex: "ws://localhost:3000").</summary>
    public required string SidecarBaseUrl { get; init; }
}
