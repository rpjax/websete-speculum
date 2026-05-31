namespace Websete.Speculum.Host.Virtualization.Services;

/// <summary>Frame de vídeo H.264 produzido pelo navegador virtual.</summary>
public sealed class Frame
{
    /// <summary>
    /// Payload completo no formato MSG_H264:
    /// <c>[0x07][isKeyframe:1][dataLen:4 LE][H.264 Annex B data]</c>.
    /// </summary>
    public ReadOnlyMemory<byte> Data      { get; init; }

    /// <summary>Timestamp de captura em Unix ms (UTC).</summary>
    public long                 Timestamp { get; init; }
}
