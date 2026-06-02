namespace Websete.Speculum.Host.Virtualization.Models;

/// <summary>Frame JPEG produzido pelo navegador virtual via CDP Page.startScreencast.</summary>
public sealed class Frame
{
    /// <summary>
    /// Payload completo no formato MSG_SCREENCAST:
    /// <c>[0x08][JPEG bytes…]</c> — sem prefixo de comprimento (o frame WS é o delimitador).
    /// </summary>
    public ReadOnlyMemory<byte> Data      { get; init; }

    /// <summary>Timestamp de captura em Unix ms (UTC).</summary>
    public long                 Timestamp { get; init; }
}
