using System.Threading.Channels;

namespace Websete.Speculum.Host.Virtualization.Services;

/// <summary>
/// Produz saídas do console JS — <c>MSG_CONSOLE</c> (log/warn/error) e
/// <c>MSG_EVAL_RESULT</c> — originadas no navegador virtual.
/// <br/>Fluxo: navegador virtual → [source] → sessão.
/// </summary>
public interface IJsConsoleOutputSource
{
    ChannelReader<ConsoleOutputEvent> GetConsoleOutputReader();
}
