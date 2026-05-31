using System.Threading.Channels;

namespace Websete.Speculum.Host.Virtualization.Services;

/// <summary>
/// Produz eventos de input originados no cliente downstream (mouse, teclado, wheel).
/// <br/>Fluxo: cliente → [source] → sessão.
/// </summary>
public interface IInputSource
{
    ChannelReader<InputEvent> GetInputEventReader();
}
