namespace Websete.Speculum.Host.Virtualization.Services;

/// <summary>Evento de input do usuário (mouse, teclado, wheel, resize).</summary>
public sealed class InputEvent
{
    /// <summary>Tipo do evento — ex: <c>"mousemove"</c>, <c>"keydown"</c>.</summary>
    public required string Type { get; init; }

    /// <summary>
    /// JSON completo do evento, pronto para relay ao sidecar
    /// — ex: <c>{"type":"mousemove","x":640,"y":360}</c>.
    /// </summary>
    public required string Payload { get; init; }
}
