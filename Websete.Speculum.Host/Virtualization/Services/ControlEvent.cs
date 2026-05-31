namespace Websete.Speculum.Host.Virtualization.Services;

/// <summary>Evento de controle originado no navegador virtual (ex: URL update).</summary>
public sealed class ControlEvent
{
    /// <summary>Tipo do evento — ex: <c>"urlchange"</c>.</summary>
    public required string Type    { get; init; }

    /// <summary>Corpo do evento (formato específico por tipo).</summary>
    public required string Payload { get; init; }
}
