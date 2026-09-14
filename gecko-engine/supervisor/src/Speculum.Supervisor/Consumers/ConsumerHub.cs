using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Threading.Channels;
using Microsoft.Extensions.Logging;
using Speculum.Supervisor.Wire;

namespace Speculum.Supervisor.Consumers;

/// <summary>
/// Registro dos consumidores conectados e distribuição dos frames para eles.
///
/// O hub nunca interpreta o conteúdo do frame — recebe bytes e reenvia bytes.
/// Roteamento, quando existir, usa o <c>contextId</c> do envelope.
/// </summary>
public sealed class ConsumerHub(ILogger<ConsumerHub> logger)
{
    private readonly ConcurrentDictionary<Guid, ConsumerConnection> _consumers = new();

    public int Count => _consumers.Count;

    /// <summary>
    /// Comando vindo de um consumidor, no mesmo ABI de controle do doc 18.
    /// O supervisor é a interface: quem pede contexto e navegação é o consumidor.
    /// </summary>
    public event Action<byte[]>? CommandReceived;

    /// <summary>
    /// Um consumidor acabou de atar. Cliente novo = Resync no mapa, não buffer de frame.
    /// </summary>
    public event Action? ConsumerAttached;

    /// <summary>Ativo vindo do consumidor (Kind 0x06 no plano de consumo).</summary>
    public event Action<uint, byte[]>? AssetFromConsumer;

    /// <summary>
    /// Serve um consumidor até que ele desconecte. O <see cref="WebSocket"/> pertence
    /// ao chamador (o pipeline do Kestrel) e é fechado por ele.
    /// </summary>
    public async Task ServeAsync(WebSocket socket, CancellationToken cancellationToken)
    {
        var consumer = new ConsumerConnection(socket, payload =>
        {
            // Envelope Asset completo — não o primeiro byte. HistoryGo é 0x0106 LE.
            if (Envelope.TryReadComplete(payload, EnvelopeKind.Asset, out var contextId, out var length))
            {
                var body = new byte[length];
                Buffer.BlockCopy(payload, Envelope.HeaderBytes, body, 0, length);
                AssetFromConsumer?.Invoke(contextId, body);
                return;
            }

            CommandReceived?.Invoke(payload);
        });
        _consumers[consumer.Id] = consumer;
        logger.LogInformation("consumidor {ConsumerId} conectado ({Count} no total)", consumer.Id, _consumers.Count);
        ConsumerAttached?.Invoke();

        try
        {
            await consumer.PumpAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            // encerramento normal
        }
        catch (WebSocketException ex)
        {
            logger.LogInformation("consumidor {ConsumerId} caiu: {Reason}", consumer.Id, ex.Message);
        }
        finally
        {
            _consumers.TryRemove(consumer.Id, out _);
            consumer.Complete();
            logger.LogInformation("consumidor {ConsumerId} desconectado ({Count} restantes)", consumer.Id, _consumers.Count);
        }
    }

    /// <summary>
    /// Enfileira um frame para todos os consumidores. Nunca bloqueia: consumidor
    /// lento perde o frame mais antigo da própria fila, não segura os outros nem o
    /// browser. Perda de frame é desync, e desync tem mecanismo próprio (resync).
    /// </summary>
    public void Broadcast(uint contextId, byte[] frame)
    {
        foreach (var consumer in _consumers.Values)
        {
            if (!consumer.TryEnqueue(frame))
            {
                logger.LogWarning("consumidor {ConsumerId} descartou frame ctx={ContextId}", consumer.Id, contextId);
            }
        }
    }

    public void BroadcastEnvelope(EnvelopeKind kind, uint contextId, byte[] payload)
    {
        var message = new byte[Envelope.HeaderBytes + payload.Length];
        Envelope.WriteHeader(message, kind, contextId, payload.Length);
        Buffer.BlockCopy(payload, 0, message, Envelope.HeaderBytes, payload.Length);
        Broadcast(contextId, message);
    }

    private sealed class ConsumerConnection(WebSocket socket, Action<byte[]> onCommand)
    {
        private const int QueueCapacity = 256;

        private readonly Channel<byte[]> _queue = Channel.CreateBounded<byte[]>(
            new BoundedChannelOptions(QueueCapacity)
            {
                FullMode = BoundedChannelFullMode.DropOldest,
                SingleReader = true,
                SingleWriter = false,
            });

        public Guid Id { get; } = Guid.NewGuid();

        public bool TryEnqueue(byte[] frame) => _queue.Writer.TryWrite(frame);

        public void Complete() => _queue.Writer.TryComplete();

        public async Task PumpAsync(CancellationToken cancellationToken)
        {
            var drain = DrainIncomingAsync(cancellationToken);

            await foreach (var frame in _queue.Reader.ReadAllAsync(cancellationToken).ConfigureAwait(false))
            {
                if (socket.State != WebSocketState.Open)
                {
                    break;
                }

                await socket
                    .SendAsync(frame, WebSocketMessageType.Binary, endOfMessage: true, cancellationToken)
                    .ConfigureAwait(false);
            }

            await drain.ConfigureAwait(false);
        }

        /// <summary>
        /// Lê comandos do consumidor. Mensagem binária é controle (doc 18);
        /// qualquer outra coisa é ignorada.
        /// </summary>
        private async Task DrainIncomingAsync(CancellationToken cancellationToken)
        {
            var buffer = new byte[8 * 1024];
            using var assembled = new MemoryStream();

            try
            {
                while (socket.State == WebSocketState.Open)
                {
                    assembled.SetLength(0);

                    WebSocketReceiveResult result;
                    do
                    {
                        result = await socket.ReceiveAsync(buffer, cancellationToken).ConfigureAwait(false);
                        if (result.MessageType == WebSocketMessageType.Close)
                        {
                            Complete();
                            return;
                        }

                        assembled.Write(buffer, 0, result.Count);
                    }
                    while (!result.EndOfMessage);

                    if (result.MessageType == WebSocketMessageType.Binary && assembled.Length > 0)
                    {
                        onCommand(assembled.ToArray());
                    }
                }
            }
            catch (OperationCanceledException)
            {
                // encerramento normal
            }
            catch (WebSocketException)
            {
                // queda do consumidor — tratada por quem chamou
            }
            finally
            {
                Complete();
            }
        }
    }
}
