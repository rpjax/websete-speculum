using System.Buffers;

namespace Speculum.Supervisor.Wire;

/// <summary>
/// Lê envelopes de um fluxo de bytes. Um envelope por vez, sem alocar por frame
/// além do payload devolvido.
/// </summary>
public sealed class EnvelopeReader(Stream stream)
{
    private readonly byte[] _header = new byte[Envelope.HeaderBytes];

    /// <summary>
    /// Lê o próximo envelope. Devolve <c>null</c> quando o fluxo termina
    /// limpo (fim de arquivo exatamente na fronteira de um envelope).
    /// </summary>
    public async ValueTask<EnvelopeMessage?> ReadAsync(CancellationToken cancellationToken)
    {
        var read = await ReadAtLeastAsync(_header, cancellationToken).ConfigureAwait(false);
        if (read == 0)
        {
            return null;
        }

        if (read < Envelope.HeaderBytes)
        {
            throw new InvalidDataException("fluxo terminou no meio de um cabeçalho");
        }

        var (kind, contextId, length) = Envelope.ReadHeader(_header);

        var payload = length == 0 ? Array.Empty<byte>() : GC.AllocateUninitializedArray<byte>(length);
        if (length > 0)
        {
            await stream.ReadExactlyAsync(payload, cancellationToken).ConfigureAwait(false);
        }

        return new EnvelopeMessage(kind, contextId, payload);
    }

    private async ValueTask<int> ReadAtLeastAsync(Memory<byte> buffer, CancellationToken cancellationToken)
    {
        var total = 0;
        while (total < buffer.Length)
        {
            var read = await stream.ReadAsync(buffer[total..], cancellationToken).ConfigureAwait(false);
            if (read == 0)
            {
                return total;
            }

            total += read;
        }

        return total;
    }
}

/// <summary>Um envelope lido. <paramref name="Payload"/> é carga opaca.</summary>
public readonly record struct EnvelopeMessage(EnvelopeKind Kind, uint ContextId, byte[] Payload);
