using Microsoft.Extensions.Logging;
using Speculum.Supervisor.Wire;
using Speculum.Wire;

namespace Speculum.Supervisor.Control;

/// <summary>
/// Schema control channel: encodes with SpeculumWire.gen, never hand codecs.
/// </summary>
public sealed class SchemaControlChannel(SchemaLinkWriter writer, ILogger logger)
{
    private int _nextId;
    private readonly FaultDispatcher _faults = new();
    private readonly SessionPolicy _policy = new();

    public event Action<ushort, uint, uint, byte[]>? MessageReceived;
    public event Action<Fault>? FaultReceived
    {
        add => _faults.Received += value;
        remove => _faults.Received -= value;
    }

    public SessionPolicy Policy => _policy;
    public FaultDispatcher Faults => _faults;
    public uint NextId() => (uint)Interlocked.Increment(ref _nextId);

    public async ValueTask SendAsync(
        ushort opcode, uint target, byte[] payload, uint correlation, CancellationToken ct)
    {
        if (!_policy.TryAcquireOfferSlot())
        {
            logger.LogWarning("vazão: offer slot esgotado — comando {Opcode} adiado", opcode);
            return;
        }

        try
        {
            await writer.WriteAsync(opcode, target, payload, correlation, ct).ConfigureAwait(false);
        }
        finally
        {
            _policy.ReleaseOfferSlot();
        }
    }

    public ValueTask SendViewportOpenAsync(uint target, Extent extent, uint corr, CancellationToken ct)
    {
        var payload = Codecs.EncodeViewportOpenBytes(new ViewportOpen { extent = extent });
        return SendAsync(OpViewportOpen.Code, target, payload, corr, ct);
    }

    public ValueTask SendNavigateAsync(uint target, string url, uint corr, CancellationToken ct)
    {
        if (!_policy.TryBeginNavigate())
        {
            logger.LogWarning("política: navigate retry esgotado");
            return ValueTask.CompletedTask;
        }

        var payload = Codecs.EncodeNavigateBytes(new Navigate { url = url });
        return SendAsync(OpNavigate.Code, target, payload, corr, ct);
    }

    public ValueTask SendResyncAsync(uint target, ResyncForce force, uint corr, CancellationToken ct)
    {
        var payload = Codecs.EncodeResyncBytes(new Resync { force = force, scope = Scope.Self });
        return SendAsync(OpResync.Code, target, payload, corr, ct);
    }

    public ValueTask SendShutdownAsync(uint corr, CancellationToken ct)
    {
        var payload = Codecs.EncodeShutdownBytes(new Shutdown());
        return SendAsync(OpShutdown.Code, 0, payload, corr, ct);
    }

    public ValueTask SendInputPointerDownAsync(
        uint target, InputPointerDown msg, uint corr, CancellationToken ct)
    {
        var payload = Codecs.EncodeInputPointerDownBytes(msg);
        return SendAsync(OpInputPointerDown.Code, target, payload, corr, ct);
    }

    public void Receive(ushort opcode, uint target, uint correlation, ReadOnlySpan<byte> payload)
    {
        if (_faults.TryDispatch(opcode, payload))
        {
            return;
        }

        MessageReceived?.Invoke(opcode, target, correlation, payload.ToArray());
    }
}
