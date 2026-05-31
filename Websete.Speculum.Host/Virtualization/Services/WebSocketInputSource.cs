using System.Threading.Channels;

namespace Websete.Speculum.Host.Virtualization.Services;

/// <summary>
/// Implementação de <see cref="IInputSource"/> que produz eventos de input
/// (mouse, teclado, wheel, resize) originados no cliente downstream.
/// </summary>
/// <remarks>
/// Delega a leitura ao <see cref="WebSocketMessageRouter"/>, que é o único
/// loop de leitura do WebSocket do cliente e roteia as mensagens por tipo.
/// </remarks>
public sealed class WebSocketInputSource : IInputSource
{
    private readonly WebSocketMessageRouter _router;

    public WebSocketInputSource(WebSocketMessageRouter router) => _router = router;

    public ChannelReader<InputEvent> GetInputEventReader() => _router.InputReader;
}
