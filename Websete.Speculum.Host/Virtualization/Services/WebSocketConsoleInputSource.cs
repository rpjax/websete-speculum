using System.Threading.Channels;

namespace Websete.Speculum.Host.Virtualization.Services;

/// <summary>
/// Implementação de <see cref="IJsConsoleInputSource"/> que produz comandos
/// <c>evaljs</c> originados no cliente downstream.
/// </summary>
/// <remarks>
/// Delega a leitura ao <see cref="WebSocketMessageRouter"/>, que é o único
/// loop de leitura do WebSocket do cliente e roteia as mensagens por tipo.
/// </remarks>
public sealed class WebSocketConsoleInputSource : IJsConsoleInputSource
{
    private readonly WebSocketMessageRouter _router;

    public WebSocketConsoleInputSource(WebSocketMessageRouter router) => _router = router;

    public ChannelReader<ConsoleInputEvent> GetConsoleInputReader() => _router.ConsoleInputReader;
}
