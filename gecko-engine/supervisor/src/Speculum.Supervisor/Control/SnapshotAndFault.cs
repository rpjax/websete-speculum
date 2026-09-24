using Speculum.Wire;

namespace Speculum.Supervisor.Control;

/// <summary>Decode schema Snapshotted for consumers.</summary>
public readonly record struct SnapshotServedPayload(
    uint CorrelationId,
    uint Sequence,
    uint Generation,
    uint Target,
    ulong TableHash,
    byte[] Dump)
{
    public static SnapshotServedPayload Decode(ushort opcode, uint target, uint correlation, ReadOnlySpan<byte> payload)
    {
        if (opcode != OpSnapshotted.Code)
        {
            throw new InvalidDataException($"esperado Snapshotted, veio 0x{opcode:X4}");
        }

        var msg = Codecs.DecodeSnapshottedBytes(payload);
        return new SnapshotServedPayload(
            correlation, msg.sequence, msg.generation, target, msg.digest, msg.dump);
    }
}

/// <summary>Typed Fault from schema — never string-split errorCode|phase.</summary>
public readonly record struct FaultPayload(
    uint CorrelationId,
    FaultCode Code,
    string Origin,
    string Message,
    FaultDatum[] Data)
{
    public static FaultPayload Decode(ushort opcode, uint correlation, ReadOnlySpan<byte> payload)
    {
        if (opcode != OpFault.Code)
        {
            throw new InvalidDataException($"esperado Fault, veio 0x{opcode:X4}");
        }

        var fault = Codecs.DecodeFaultBytes(payload);
        if (!FaultDispatcher.IsCatalogued(fault.code))
        {
            throw new InvalidDataException($"FaultCode {(ushort)fault.code} fora do catálogo");
        }

        return new FaultPayload(correlation, fault.code, fault.origin, fault.message, fault.data);
    }
}
