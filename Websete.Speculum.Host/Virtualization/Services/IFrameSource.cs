using System.Threading.Channels;

namespace Websete.Speculum.Host.Virtualization.Services;

/// <summary>
/// Produz frames de vídeo H.264 originados no navegador virtual.
/// <br/>Fluxo: navegador virtual → [source] → sessão.
/// </summary>
public interface IFrameSource
{
    ChannelReader<Frame> GetFrameReader();
}
