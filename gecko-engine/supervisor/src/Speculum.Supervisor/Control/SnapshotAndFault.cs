namespace Speculum.Supervisor.Control;

/// <summary>Decode completo de SnapshotServed (dump incluído) para o consumidor.</summary>
public readonly record struct SnapshotServedPayload(
    uint CorrelationId,
    uint Sequence,
    uint Generation,
    uint ContextId,
    ulong TableHash,
    byte[] Dump)
{
    public static SnapshotServedPayload Decode(ReadOnlySpan<byte> payload)
    {
        var reader = new ControlReader(payload);
        if (reader.OpCode != ControlOpCode.SnapshotServed)
        {
            throw new InvalidDataException($"esperado SnapshotServed, veio {reader.OpCode}");
        }

        var sequence = reader.ReadUInt32();
        var generation = reader.ReadUInt32();
        var contextId = reader.ReadUInt32();
        var tableHash = reader.ReadUInt64();
        var dump = reader.ReadBytes();
        return new SnapshotServedPayload(
            reader.CorrelationId, sequence, generation, contextId, tableHash, dump);
    }
}

/// <summary>Fault ABI com errorCode|phase quando a causa usa esse formato.</summary>
public readonly record struct FaultPayload(
    uint CorrelationId,
    uint ContextId,
    string Reason,
    string ErrorCode,
    string Phase)
{
    public static FaultPayload Decode(ReadOnlySpan<byte> payload)
    {
        var reader = new ControlReader(payload);
        if (reader.OpCode != ControlOpCode.Fault)
        {
            throw new InvalidDataException($"esperado Fault, veio {reader.OpCode}");
        }

        var contextId = reader.ReadUInt32();
        var reason = reader.ReadString();
        var errorCode = reason;
        var phase = "";
        var sep = reason.IndexOf('|');
        if (sep >= 0)
        {
            errorCode = reason[..sep];
            phase = reason[(sep + 1)..];
        }

        return new FaultPayload(reader.CorrelationId, contextId, reason, errorCode, phase);
    }
}
