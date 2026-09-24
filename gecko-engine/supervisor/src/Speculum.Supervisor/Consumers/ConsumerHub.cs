using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Threading.Channels;
using Microsoft.Extensions.Logging;
using Speculum.Supervisor.Wire;
using Speculum.Wire;

namespace Speculum.Supervisor.Consumers;

/// <summary>
/// Consumer hub — broadcasts opaque schema envelopes. Never interprets Patch ISA.
/// </summary>
public sealed class ConsumerHub(ILogger<ConsumerHub> logger)
{
    private readonly ConcurrentDictionary<Guid, ConsumerConnection> _consumers = new();

    public int Count => _consumers.Count;

    public event Action<byte[]>? CommandReceived;
    public event Action? ConsumerAttached;
    public event Action? LastConsumerLeft;
    public event Action<uint, byte[]>? AssetFromConsumer;

    public async Task ServeAsync(WebSocket socket, CancellationToken cancellationToken)
    {
        var consumer = new ConsumerConnection(socket, payload =>
        {
            if (SchemaEnvelope.TryReadComplete(
                    payload, OpAssetRequest.Code, out var target, out var length, out _))
            {
                var body = new byte[length];
                Buffer.BlockCopy(payload, SchemaEnvelope.HeaderBytes, body, 0, length);
                AssetFromConsumer?.Invoke(target, body);
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
            if (_consumers.IsEmpty)
            {
                LastConsumerLeft?.Invoke();
            }
        }
    }

    public void Broadcast(uint target, byte[] frame)
    {
        foreach (var consumer in _consumers.Values)
        {
            if (!consumer.TryEnqueue(frame))
            {
                Interlocked.Increment(ref _framesDropped);
                logger.LogWarning(
                    "consumidor {ConsumerId} descartou frame target={Target} drops={Drops}",
                    consumer.Id,
                    target,
                    FramesDropped);
            }
        }
    }

    public long FramesDropped => Interlocked.Read(ref _framesDropped);
    private long _framesDropped;

    public void BroadcastSchema(ushort opcode, uint target, byte[] payload, uint correlation = 0)
    {
        Broadcast(target, SchemaEnvelope.Pack(opcode, target, payload, correlation));
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
            var send = SendLoopAsync(cancellationToken);
            var recv = RecvLoopAsync(cancellationToken);
            await Task.WhenAny(send, recv).ConfigureAwait(false);
            Complete();
            await Task.WhenAll(IgnoreCancel(send), IgnoreCancel(recv)).ConfigureAwait(false);
        }

        private async Task SendLoopAsync(CancellationToken cancellationToken)
        {
            await foreach (var frame in _queue.Reader.ReadAllAsync(cancellationToken).ConfigureAwait(false))
            {
                await socket.SendAsync(frame, WebSocketMessageType.Binary, true, cancellationToken)
                    .ConfigureAwait(false);
            }
        }

        private async Task RecvLoopAsync(CancellationToken cancellationToken)
        {
            var buffer = new byte[64 * 1024];
            while (!cancellationToken.IsCancellationRequested && socket.State == WebSocketState.Open)
            {
                using var ms = new MemoryStream();
                WebSocketReceiveResult result;
                do
                {
                    result = await socket.ReceiveAsync(buffer, cancellationToken).ConfigureAwait(false);
                    if (result.MessageType == WebSocketMessageType.Close)
                    {
                        return;
                    }

                    ms.Write(buffer, 0, result.Count);
                }
                while (!result.EndOfMessage);

                onCommand(ms.ToArray());
            }
        }

        private static async Task IgnoreCancel(Task task)
        {
            try
            {
                await task.ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
            }
        }
    }
}
