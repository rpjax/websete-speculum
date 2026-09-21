namespace Speculum.Supervisor.Wire;

/// <summary>
/// Escreve envelopes num fluxo. Serializa as escritas: um envelope nunca sai
/// entrelaçado com outro.
/// </summary>
public sealed class EnvelopeWriter(Stream stream) : IAsyncDisposable
{
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly byte[] _header = new byte[Envelope.HeaderBytes];

    public async ValueTask WriteAsync(
        EnvelopeKind kind,
        uint contextId,
        ReadOnlyMemory<byte> payload,
        CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            Envelope.WriteHeader(_header, kind, contextId, payload.Length);
            await stream.WriteAsync(_header, cancellationToken).ConfigureAwait(false);
            if (!payload.IsEmpty)
            {
                await stream.WriteAsync(payload, cancellationToken).ConfigureAwait(false);
            }

            await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            _gate.Release();
        }
    }

    public ValueTask DisposeAsync()
    {
        _gate.Dispose();
        return ValueTask.CompletedTask;
    }
}
