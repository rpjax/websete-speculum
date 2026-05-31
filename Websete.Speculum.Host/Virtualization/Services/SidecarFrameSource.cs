using System.Threading.Channels;
using Websete.Speculum.Browser;

namespace Websete.Speculum.Host.Virtualization.Services;

/// <summary>
/// Implementação de <see cref="IFrameSource"/> que produz frames H.264
/// lendo continuamente de <see cref="SidecarClient.VideoChannel"/>.
/// </summary>
/// <remarks>
/// Inicia uma task de pump no construtor. Quando o <see cref="SidecarClient"/>
/// é descartado ele completa seu canal interno, o pump encerra naturalmente e
/// completa o canal exposto — fazendo o loop de <see cref="VSession"/> sair
/// sem cancelamento explícito.
/// </remarks>
public sealed class SidecarFrameSource : IFrameSource, IAsyncDisposable
{
    private readonly Channel<Frame>          _channel;
    private readonly CancellationTokenSource _cts      = new();
    private readonly Task                    _pumpTask;

    public SidecarFrameSource(SidecarClient client)
    {
        // Bounded + DropOldest: vídeo ao vivo — o frame mais antigo no buffer
        // tem menos valor que o frame atual, então frames atrasados são descartados.
        _channel = Channel.CreateBounded<Frame>(new BoundedChannelOptions(2)
        {
            FullMode     = BoundedChannelFullMode.DropOldest,
            SingleReader = true,
            SingleWriter = true,
        });

        _pumpTask = PumpAsync(client.VideoChannel, _cts.Token);
    }

    // ── IFrameSource ──────────────────────────────────────────────────────────

    public ChannelReader<Frame> GetFrameReader() => _channel.Reader;

    // ── Pump interno ──────────────────────────────────────────────────────────

    private async Task PumpAsync(ChannelReader<ReadOnlyMemory<byte>> source, CancellationToken ct)
    {
        try
        {
            await foreach (var data in source.ReadAllAsync(ct))
            {
                // Com DropOldest, TryWrite nunca falha — sempre abre espaço
                _channel.Writer.TryWrite(new Frame
                {
                    Data      = data,
                    Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                });
            }
        }
        catch (OperationCanceledException) { }
        finally
        {
            // Propaga EOF ao consumidor: ForwardPipelineAsync encerra o loop limpo
            _channel.Writer.TryComplete();
        }
    }

    // ── IAsyncDisposable ──────────────────────────────────────────────────────

    public async ValueTask DisposeAsync()
    {
        await _cts.CancelAsync();
        try { await _pumpTask; } catch { /* OperationCanceledException esperada */ }
        _cts.Dispose();
    }
}
