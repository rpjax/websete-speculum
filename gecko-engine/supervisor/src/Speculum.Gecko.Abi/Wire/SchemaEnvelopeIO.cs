using Speculum.Wire;

namespace Speculum.Supervisor.Wire;

/// <summary>
/// Async stream of schema envelopes (16-byte header + payload).
/// </summary>
public sealed class SchemaEnvelopeReader(Stream stream)
{
    private readonly byte[] _header = new byte[SchemaEnvelope.HeaderBytes];

    public async ValueTask<SchemaEnvelopeMessage?> ReadAsync(CancellationToken cancellationToken)
    {
        var read = await ReadExactAsync(stream, _header, cancellationToken).ConfigureAwait(false);
        if (read == 0)
        {
            return null;
        }

        if (read < SchemaEnvelope.HeaderBytes)
        {
            throw new InvalidDataException("envelope truncado");
        }

        var (opcode, target, length, correlation) = SchemaEnvelope.ReadHeader(_header);
        var payload = length == 0 ? Array.Empty<byte>() : new byte[length];
        if (length > 0)
        {
            var got = await ReadExactAsync(stream, payload, cancellationToken).ConfigureAwait(false);
            if (got < length)
            {
                throw new InvalidDataException("payload truncado");
            }
        }

        return new SchemaEnvelopeMessage(opcode, target, correlation, payload);
    }

    private static async ValueTask<int> ReadExactAsync(
        Stream stream, byte[] buffer, CancellationToken cancellationToken)
    {
        var offset = 0;
        while (offset < buffer.Length)
        {
            var n = await stream.ReadAsync(buffer.AsMemory(offset), cancellationToken).ConfigureAwait(false);
            if (n == 0)
            {
                return offset;
            }

            offset += n;
        }

        return offset;
    }
}

public sealed class SchemaEnvelopeWriter(Stream stream) : IAsyncDisposable
{
    private readonly byte[] _header = new byte[SchemaEnvelope.HeaderBytes];

    public async ValueTask WriteAsync(
        ushort opcode, uint target, ReadOnlyMemory<byte> payload, uint correlation,
        CancellationToken cancellationToken)
    {
        SchemaEnvelope.WriteHeader(_header, opcode, target, payload.Length, correlation);
        await stream.WriteAsync(_header, cancellationToken).ConfigureAwait(false);
        if (payload.Length > 0)
        {
            await stream.WriteAsync(payload, cancellationToken).ConfigureAwait(false);
        }

        await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
    }

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;
}

public readonly record struct SchemaEnvelopeMessage(
    ushort Opcode, uint Target, uint Correlation, byte[] Payload);
