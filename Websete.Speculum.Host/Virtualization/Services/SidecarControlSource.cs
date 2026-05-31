using System.Threading.Channels;

namespace Websete.Speculum.Host.Virtualization.Services;

/// <summary>
/// Implementação de <see cref="IControlSource"/> que produz eventos de controle
/// (URL updates, navegação) originados no sidecar.
/// </summary>
/// <remarks>
/// Delega a leitura ao <see cref="SidecarOutputRouter"/>, que é o único
/// consumidor do <c>ControlChannel</c> do sidecar e roteia as mensagens
/// para os canais corretos.
/// </remarks>
public sealed class SidecarControlSource : IControlSource
{
    private readonly SidecarOutputRouter _router;

    public SidecarControlSource(SidecarOutputRouter router) => _router = router;

    public ChannelReader<ControlEvent> GetControlEventReader() => _router.ControlReader;
}
