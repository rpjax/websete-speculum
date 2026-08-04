using MessagePack;

namespace Speculum.Api.Sessions.Models;

/// <summary>
/// Coordinate-space user input for <see cref="Configurations.Models.Sessions.MirrorMode.VideoStreaming"/>.
/// </summary>
[MessagePackObject]
public sealed class VideoStreamingInput
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
