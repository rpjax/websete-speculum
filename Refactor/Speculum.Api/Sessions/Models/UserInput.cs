using MessagePack;

namespace Speculum.Api.Sessions.Models;

/// <summary>Evento de input do usuário (mouse, teclado, wheel, resize).</summary>
[MessagePackObject]
public sealed class UserInput
{
    /// <summary>Tipo do evento — ex: <c>"mousemove"</c>, <c>"keydown"</c>.</summary>
    [Key("type")]
    public required string Type { get; init; }

    /// <summary>
    /// JSON completo do evento, pronto para relay ao sidecar
    /// — ex: <c>{"type":"mousemove","x":640,"y":360}</c>.
    /// </summary>
    [Key("payload")]
    public required string Payload { get; init; }
}
