using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;

namespace Websete.Speculum.Host.Virtualization.Services;

/// <summary>
/// Infraestrutura interna: lê mensagens JSON do WebSocket do cliente e as
/// roteia ao canal correto com base no campo <c>"type"</c>.
/// </summary>
/// <remarks>
/// Este router não implementa nenhuma interface de serviço — é plumbing
/// compartilhado por <see cref="WebSocketInputSource"/> e
/// <see cref="WebSocketConsoleInputSource"/>, que injetam este objeto e cada
/// uma expõe apenas o seu próprio <c>ChannelReader</c>.<br/>
/// Um único loop de leitura é obrigatório: WebSocket não suporta leituras
/// concorrentes.
/// </remarks>
public sealed class WebSocketMessageRouter : IAsyncDisposable
{
    private readonly Channel<InputEvent>        _inputChannel;
    private readonly Channel<ConsoleInputEvent> _consoleChannel;
    private readonly CancellationTokenSource    _cts      = new();
    private readonly Task                       _readTask;

    public WebSocketMessageRouter(WebSocket socket)
    {
        _inputChannel = Channel.CreateUnbounded<InputEvent>(
            new UnboundedChannelOptions { SingleReader = true, SingleWriter = true });

        _consoleChannel = Channel.CreateUnbounded<ConsoleInputEvent>(
            new UnboundedChannelOptions { SingleReader = true, SingleWriter = true });

        _readTask = ReadLoopAsync(socket, _cts.Token);
    }

    // ── Canais expostos às implementações especializadas ──────────────────────

    internal ChannelReader<InputEvent>        InputReader        => _inputChannel.Reader;
    internal ChannelReader<ConsoleInputEvent> ConsoleInputReader => _consoleChannel.Reader;

    // ── Read loop ─────────────────────────────────────────────────────────────

    private async Task ReadLoopAsync(WebSocket socket, CancellationToken ct)
    {
        var buf    = new byte[64 * 1024];
        int filled = 0;

        try
        {
            while (!ct.IsCancellationRequested && socket.State == WebSocketState.Open)
            {
                var result = await socket.ReceiveAsync(buf.AsMemory(filled), ct);

                if (result.MessageType == WebSocketMessageType.Close) break;

                filled += result.Count;
                if (!result.EndOfMessage) continue;

                if (filled > 0)
                {
                    Dispatch(buf.AsMemory(0, filled));
                    filled = 0;
                }
            }
        }
        catch (OperationCanceledException) { }
        catch (WebSocketException) { /* cliente desconectou abruptamente */ }
        finally
        {
            _inputChannel.Writer.TryComplete();
            _consoleChannel.Writer.TryComplete();
        }
    }

    /// <summary>
    /// Parseia o JSON e publica no canal correto.
    /// Mensagens malformadas são descartadas silenciosamente.
    /// </summary>
    private void Dispatch(ReadOnlyMemory<byte> raw)
    {
        try
        {
            using var doc  = JsonDocument.Parse(raw);
            var       root = doc.RootElement;

            if (!root.TryGetProperty("type", out var typeProp)) return;
            var type = typeProp.GetString();

            if (type == "evaljs")
            {
                var id   = root.TryGetProperty("id",   out var idP)   ? idP.GetInt32()                : 0;
                var code = root.TryGetProperty("code", out var codeP) ? codeP.GetString() ?? string.Empty : string.Empty;
                _consoleChannel.Writer.TryWrite(new ConsoleInputEvent { Id = id, Code = code });
            }
            else
            {
                _inputChannel.Writer.TryWrite(new InputEvent
                {
                    Type    = type ?? string.Empty,
                    Payload = Encoding.UTF8.GetString(raw.Span),
                });
            }
        }
        catch (JsonException) { /* mensagem malformada — descarta */ }
    }

    // ── IAsyncDisposable ──────────────────────────────────────────────────────

    public async ValueTask DisposeAsync()
    {
        await _cts.CancelAsync();
        try { await _readTask; } catch { }
        _cts.Dispose();
    }
}
