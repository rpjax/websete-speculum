using System.Net.WebSockets;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Speculum.Supervisor.Wire;
using Speculum.Wire;

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

    /// <summary>Ativo schema (AssetChunk/End/Denied), payload sem o envelope.</summary>
    public event Action<uint, byte[]>? AssetReceived;

    /// <summary>Telemetria schema OpTelemetry, payload sem o envelope.</summary>
    public event Action<uint, byte[]>? TelemetryReceived;

    public bool Connected { get; private set; }

    /// <summary>Todo binário recebido do supervisor (PP + telemetria + ativo no fio).</summary>
    public long MessagesReceived => Interlocked.Read(ref _messagesReceived);

    /// <summary>Frames de projeção (OpPatch, envelope completo).</summary>
    public long ProjectionFramesReceived => Interlocked.Read(ref _projectionFramesReceived);

    /// <summary>Envelopes de telemetria decodificados.</summary>
    public long TelemetryEnvelopesReceived => Interlocked.Read(ref _telemetryEnvelopesReceived);

    /// <summary>Bytes recebidos do supervisor desde que o lab subiu.</summary>
    public long BytesReceived => Interlocked.Read(ref _bytesReceived);

    private long _messagesReceived;
    private long _projectionFramesReceived;
    private long _telemetryEnvelopesReceived;
    private long _bytesReceived;

    /// <summary>Compat: mesmo que <see cref="MessagesReceived"/>.</summary>
    public long FramesReceived => MessagesReceived;

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
            Interlocked.Increment(ref _messagesReceived);
            Interlocked.Add(ref _bytesReceived, frame.LongLength);
            if (frame.Length >= SchemaEnvelope.HeaderBytes)
            {
                try
                {
                    var (opcode, target, length, _) = SchemaEnvelope.ReadHeader(frame);
                    var body = length == 0
                        ? Array.Empty<byte>()
                        : frame.AsSpan(SchemaEnvelope.HeaderBytes, length).ToArray();
                    if (opcode == OpPatch.Code)
                    {
                        Interlocked.Increment(ref _projectionFramesReceived);
                        FrameReceived?.Invoke(frame);
                        continue;
                    }
                    if (opcode == OpAssetChunk.Code || opcode == OpAssetEnd.Code || opcode == OpAssetDenied.Code)
                    {
                        AssetReceived?.Invoke(target, body);
                        continue;
                    }
                    if (opcode == OpTelemetry.Code)
                    {
                        Interlocked.Increment(ref _telemetryEnvelopesReceived);
                        TelemetryReceived?.Invoke(target, body);
                        continue;
                    }
                    // Control / lifecycle events — full envelope to Lab.
                    EventReceived?.Invoke(frame);
                    continue;
                }
                catch (InvalidDataException)
                {
                }
            }

            Interlocked.Increment(ref _projectionFramesReceived);
            FrameReceived?.Invoke(frame);
        }
    }
}
