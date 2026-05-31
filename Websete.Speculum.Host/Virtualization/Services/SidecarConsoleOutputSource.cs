using System.Threading.Channels;

namespace Websete.Speculum.Host.Virtualization.Services;

/// <summary>
/// Implementação de <see cref="IJsConsoleOutputSource"/> que produz saídas do
/// console JS (<c>MSG_CONSOLE</c>, <c>MSG_EVAL_RESULT</c>) originadas no sidecar.
/// </summary>
/// <remarks>
/// Delega a leitura ao <see cref="SidecarOutputRouter"/>, que é o único
/// consumidor do <c>ControlChannel</c> do sidecar e roteia as mensagens
/// para os canais corretos.
/// </remarks>
public sealed class SidecarConsoleOutputSource : IJsConsoleOutputSource
{
    private readonly SidecarOutputRouter _router;

    public SidecarConsoleOutputSource(SidecarOutputRouter router) => _router = router;

    public ChannelReader<ConsoleOutputEvent> GetConsoleOutputReader() => _router.ConsoleOutputReader;
}
