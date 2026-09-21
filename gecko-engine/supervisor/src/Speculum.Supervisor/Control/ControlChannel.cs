using Microsoft.Extensions.Logging;
using Speculum.Supervisor.Wire;

namespace Speculum.Supervisor.Control;

/// <summary>
/// O canal de controle da sessão: envia comandos ao browser e entrega os eventos
/// que vêm dele.
///
/// Assíncrono e sem bloqueio de linha — o id de correlação é de quem responde,
/// não de quem espera (doc 18 §2).
/// </summary>
public sealed class ControlChannel(EnvelopeWriter writer, ILogger logger)
{
    private int _nextId;

    /// <summary>Evento decodificado vindo do browser.</summary>
    public event Action<BrowserEvent, byte[]>? EventReceived;

    public uint NextId() => (uint)Interlocked.Increment(ref _nextId);

    public async ValueTask SendAsync(byte[] command, uint contextId, CancellationToken cancellationToken)
    {
        await writer.WriteAsync(EnvelopeKind.Control, contextId, command, cancellationToken).ConfigureAwait(false);
    }

    public async ValueTask SendKindAsync(
        EnvelopeKind kind, uint contextId, byte[] payload, CancellationToken cancellationToken)
    {
        await writer.WriteAsync(kind, contextId, payload, cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Chamado pela ponte quando chega um envelope de evento.</summary>
    public void Receive(ReadOnlySpan<byte> payload)
    {
        BrowserEvent message;
        try
        {
            message = BrowserEvent.Decode(payload);
        }
        catch (InvalidDataException ex)
        {
            // Malformado é ruído, não queda: a ponte é o link vital (doc 17 §3).
            logger.LogWarning("evento do browser ilegível: {Reason}", ex.Message);
            return;
        }

        logger.LogInformation("<- {OpCode} id={Id}", message.OpCode, message.CorrelationId);
        EventReceived?.Invoke(message, payload.ToArray());
    }
}
