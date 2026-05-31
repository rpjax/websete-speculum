using System.Text;
using System.Threading.Channels;
using Websete.Speculum.Browser;

namespace Websete.Speculum.Host.Virtualization.Services;

/// <summary>
/// Infraestrutura interna: lê <see cref="SidecarClient.ControlChannel"/> e
/// roteia cada mensagem binária ao canal tipado correto com base no byte de tipo.
/// </summary>
/// <remarks>
/// Este router não implementa nenhuma interface de serviço — é plumbing
/// compartilhado por <see cref="SidecarControlSource"/> e
/// <see cref="SidecarConsoleOutputSource"/>, que injetam este objeto e cada
/// uma expõe apenas o seu próprio <c>ChannelReader</c>.
/// </remarks>
public sealed class SidecarOutputRouter : IAsyncDisposable
{
    // Constantes de protocolo (SidecarProtocol é internal no projeto Browser)
    private const byte MsgUrl        = 0x04;
    private const byte MsgConsole    = 0x05;
    private const byte MsgEvalResult = 0x06;

    private readonly Channel<ControlEvent>       _controlChannel;
    private readonly Channel<ConsoleOutputEvent> _consoleChannel;
    private readonly CancellationTokenSource     _cts      = new();
    private readonly Task                        _pumpTask;

    public SidecarOutputRouter(SidecarClient client)
    {
        _controlChannel = Channel.CreateUnbounded<ControlEvent>(
            new UnboundedChannelOptions { SingleReader = true, SingleWriter = true });

        _consoleChannel = Channel.CreateUnbounded<ConsoleOutputEvent>(
            new UnboundedChannelOptions { SingleReader = true, SingleWriter = true });

        _pumpTask = PumpAsync(client.ControlChannel, _cts.Token);
    }

    // ── Canais expostos às implementações especializadas ──────────────────────

    internal ChannelReader<ControlEvent>       ControlReader       => _controlChannel.Reader;
    internal ChannelReader<ConsoleOutputEvent> ConsoleOutputReader => _consoleChannel.Reader;

    // ── Pump + roteamento ─────────────────────────────────────────────────────

    private async Task PumpAsync(ChannelReader<ReadOnlyMemory<byte>> source, CancellationToken ct)
    {
        try
        {
            await foreach (var data in source.ReadAllAsync(ct))
            {
                if (data.Length == 0) continue;

                switch (data.Span[0])
                {
                    case MsgUrl:
                        RouteUrlUpdate(data);
                        break;

                    case MsgConsole:
                    case MsgEvalResult:
                        // Relay direto: já está no formato wire correto, sem re-serialização
                        _consoleChannel.Writer.TryWrite(new ConsoleOutputEvent { Data = data });
                        break;
                }
            }
        }
        catch (OperationCanceledException) { }
        finally
        {
            _controlChannel.Writer.TryComplete();
            _consoleChannel.Writer.TryComplete();
        }
    }

    /// <summary>
    /// Parseia MSG_URL — <c>[0x04][len:4 LE][UTF-8 url]</c> — e publica
    /// um <see cref="ControlEvent"/> com a URL extraída.
    /// </summary>
    private void RouteUrlUpdate(ReadOnlyMemory<byte> data)
    {
        if (data.Length < 6) return;
        var len = BitConverter.ToUInt32(data.Span.Slice(1, 4));
        if (data.Length < 5 + len) return;
        var url = Encoding.UTF8.GetString(data.Span.Slice(5, (int)len));
        _controlChannel.Writer.TryWrite(new ControlEvent { Type = "urlchange", Payload = url });
    }

    // ── IAsyncDisposable ──────────────────────────────────────────────────────

    public async ValueTask DisposeAsync()
    {
        await _cts.CancelAsync();
        try { await _pumpTask; } catch { }
        _cts.Dispose();
    }
}
