using Speculum.Wire;

namespace Speculum.Supervisor.Wire;

/// <summary>Serialised write of schema envelopes onto the motor link.</summary>
public sealed class SchemaLinkWriter(Stream stream) : IAsyncDisposable
{
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly SchemaEnvelopeWriter _inner = new(stream);

    public async ValueTask WriteAsync(
        ushort opcode, uint target, ReadOnlyMemory<byte> payload, uint correlation,
        CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            await _inner.WriteAsync(opcode, target, payload, correlation, cancellationToken)
                .ConfigureAwait(false);
        }
        finally
        {
            _gate.Release();
        }
    }

    public ValueTask DisposeAsync()
    {
        _gate.Dispose();
        return _inner.DisposeAsync();
    }
}
