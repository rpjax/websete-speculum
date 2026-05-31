using System.Threading.Channels;

namespace Websete.Speculum.Host.Virtualization.Services;

/// <summary>
/// Produz eventos de controle (URL update, navegação) originados no navegador virtual.
/// <br/>Fluxo: navegador virtual → [source] → sessão.
/// </summary>
public interface IControlSource
{
    ChannelReader<ControlEvent> GetControlEventReader();
}
