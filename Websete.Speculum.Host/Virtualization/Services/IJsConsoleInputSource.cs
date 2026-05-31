using System.Threading.Channels;

namespace Websete.Speculum.Host.Virtualization.Services;

/// <summary>
/// Produz comandos <c>evaljs</c> originados no cliente downstream.
/// <br/>Fluxo: cliente → [source] → sessão.
/// </summary>
public interface IJsConsoleInputSource
{
    ChannelReader<ConsoleInputEvent> GetConsoleInputReader();
}
