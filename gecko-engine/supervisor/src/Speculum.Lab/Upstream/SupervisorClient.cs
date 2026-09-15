using System.Net.WebSockets;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Speculum.Supervisor.Wire;

namespace Speculum.Lab.Upstream;

/// <summary>
/// Cliente do plano de consumo do supervisor.
///
/// O lab é consumidor do supervisor exatamente como o Live será — é isso que faz
/// dele prova da interface e não um arnês paralelo. Ele nunca fala com o Gecko.
/// </summary>
public sealed class SupervisorClient(LabOptions options, ILogger<SupervisorClient> logger) : BackgroundService
{
    private static readonly TimeSpan RetryDelay = TimeSpan.FromSeconds(2);
    private const int ReceiveChunkBytes = 64 * 1024;

    /// <summary>Disparado a cada frame recebido. Os bytes são opacos.</summary>
    public event Action<byte[]>? FrameReceived;

    /// <summary>Pedido do browser (diálogo / permissão / download), payload ABI cru.</summary>
    public event Action<byte[]>? EventReceived;

    /// <summary>Ativo Kind 0x06, payload sem o envelope.</summary>
    public event Action<uint, byte[]>? AssetReceived;

    public bool Connected { get; private set; }

    /// <summary>Frames recebidos do supervisor desde que o lab subiu.</summary>
    public long FramesReceived => Interlocked.Read(ref _framesReceived);

    /// <summary>Bytes recebidos do supervisor desde que o lab subiu.</summary>
    public long BytesReceived => Interlocked.Read(ref _bytesReceived);

    private long _framesReceived;
    private long _bytesReceived;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await ConsumeAsync(stoppingToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                logger.LogWarning("supervisor indisponível ({Reason}) — nova tentativa em {Delay}s",
                    ex.Message, RetryDelay.TotalSeconds);
            }
            finally
            {
                Connected = false;
                _socket = null;
            }

            await Task.Delay(RetryDelay, stoppingToken).ConfigureAwait(false);
        }
    }

    private ClientWebSocket? _socket;

    /// <summary>
    /// Envia um comando ao supervisor no ABI de controle (doc 18). O lab pede;
    /// quem comanda o browser é o supervisor.
    /// </summary>
    public async ValueTask<bool> SendCommandAsync(byte[] command, CancellationToken cancellationToken)
    {
        var socket = _socket;
        if (socket is null || socket.State != WebSocketState.Open)
        {
            logger.LogWarning("comando descartado: supervisor não está conectado");
            return false;
        }

        await socket.SendAsync(command, WebSocketMessageType.Binary, endOfMessage: true, cancellationToken)
            .ConfigureAwait(false);
        return true;
    }

    private async Task ConsumeAsync(CancellationToken cancellationToken)
    {
        using var socket = new ClientWebSocket();
        await socket.ConnectAsync(options.SupervisorUri, cancellationToken).ConfigureAwait(false);
        _socket = socket;
        Connected = true;
        logger.LogInformation("conectado ao supervisor em {Uri}", options.SupervisorUri);

        var buffer = new byte[ReceiveChunkBytes];
        using var assembled = new MemoryStream();

        while (socket.State == WebSocketState.Open && !cancellationToken.IsCancellationRequested)
        {
            assembled.SetLength(0);

            WebSocketReceiveResult result;
            do
            {
                result = await socket.ReceiveAsync(buffer, cancellationToken).ConfigureAwait(false);

                if (result.MessageType == WebSocketMessageType.Close)
                {
                    logger.LogInformation("supervisor fechou a conexão");
                    return;
                }

                assembled.Write(buffer, 0, result.Count);
            }
            while (!result.EndOfMessage);

            if (result.MessageType != WebSocketMessageType.Binary || assembled.Length == 0)
            {
                continue;
            }

            var frame = assembled.ToArray();
            Interlocked.Increment(ref _framesReceived);
            Interlocked.Add(ref _bytesReceived, frame.LongLength);
            if (Envelope.TryReadComplete(frame, EnvelopeKind.Asset, out var assetCtx, out var assetLen))
            {
                var body = new byte[assetLen];
                Buffer.BlockCopy(frame, Envelope.HeaderBytes, body, 0, assetLen);
                AssetReceived?.Invoke(assetCtx, body);
                continue;
            }

            if (Envelope.TryReadComplete(frame, EnvelopeKind.BrowserEvent, out _, out var eventLen))
            {
                var body = new byte[eventLen];
                Buffer.BlockCopy(frame, Envelope.HeaderBytes, body, 0, eventLen);
                EventReceived?.Invoke(body);
                continue;
            }

            FrameReceived?.Invoke(frame);
        }
    }
}
