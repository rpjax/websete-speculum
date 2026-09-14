namespace Speculum.Supervisor.Control;

/// <summary>
/// Evento recebido do browser, já decodificado. Campos ausentes por opcode ficam
/// no valor neutro — quem trata conhece o próprio opcode.
/// </summary>
public readonly record struct BrowserEvent(
    ControlOpCode OpCode,
    uint CorrelationId,
    uint ContextId,
    ulong BrowsingContextId,
    uint ParentContextId,
    string? Text)
{
    public static BrowserEvent Decode(ReadOnlySpan<byte> payload)
    {
        var reader = new ControlReader(payload);

        return reader.OpCode switch
        {
            ControlOpCode.Ready =>
                new BrowserEvent(reader.OpCode, reader.CorrelationId, 0, 0, 0, null),

            ControlOpCode.Heartbeat =>
                new BrowserEvent(reader.OpCode, reader.CorrelationId, 0, reader.ReadUInt64(), 0, null),

            ControlOpCode.ContextCreated =>
                DecodeContextCreated(ref reader),

            ControlOpCode.ContextDestroyed =>
                new BrowserEvent(reader.OpCode, reader.CorrelationId, reader.ReadUInt32(), 0, 0, null),

            ControlOpCode.Navigated =>
                DecodeNavigated(ref reader),

            ControlOpCode.Fault =>
                DecodeFault(ref reader),

            // Opcode conhecido mas ainda sem campos tratados, ou desconhecido:
            // devolvido cru. Desconhecido nunca derruba a ponte (doc 18 §4).
            _ => new BrowserEvent(reader.OpCode, reader.CorrelationId, 0, 0, 0, null),
        };
    }

    private static BrowserEvent DecodeContextCreated(ref ControlReader reader)
    {
        var contextId = reader.ReadUInt32();
        var browsingContextId = reader.ReadUInt64();
        var parentContextId = reader.ReadUInt32();
        return new BrowserEvent(
            ControlOpCode.ContextCreated, reader.CorrelationId, contextId, browsingContextId, parentContextId, null);
    }

    private static BrowserEvent DecodeNavigated(ref ControlReader reader)
    {
        var contextId = reader.ReadUInt32();
        var url = reader.ReadString();
        return new BrowserEvent(ControlOpCode.Navigated, reader.CorrelationId, contextId, 0, 0, url);
    }

    private static BrowserEvent DecodeFault(ref ControlReader reader)
    {
        var contextId = reader.ReadUInt32();
        var reason = reader.ReadString();
        return new BrowserEvent(ControlOpCode.Fault, reader.CorrelationId, contextId, 0, 0, reason);
    }
}

/// <summary>Comandos do supervisor para o browser, já serializados em bytes.</summary>
public static class ControlCommand
{
    public static byte[] ContextCreate(uint correlationId, uint contextId, int width, int height)
    {
        var buffer = new byte[ControlWriter.HeaderBytes + sizeof(uint) + sizeof(int) + sizeof(int)];
        var writer = new ControlWriter(buffer, ControlOpCode.ContextCreate, correlationId);
        writer.WriteUInt32(contextId);
        writer.WriteInt32(width);
        writer.WriteInt32(height);
        return buffer;
    }

    public static byte[] ContextDestroy(uint correlationId, uint contextId)
    {
        var buffer = new byte[ControlWriter.HeaderBytes + sizeof(uint)];
        var writer = new ControlWriter(buffer, ControlOpCode.ContextDestroy, correlationId);
        writer.WriteUInt32(contextId);
        return buffer;
    }

    public static byte[] Navigate(uint correlationId, uint contextId, string url)
    {
        var buffer = new byte[ControlWriter.HeaderBytes + sizeof(uint) + ControlWriter.SizeOfString(url)];
        var writer = new ControlWriter(buffer, ControlOpCode.Navigate, correlationId);
        writer.WriteUInt32(contextId);
        writer.WriteString(url);
        return buffer;
    }

    public static byte[] Shutdown(uint correlationId)
    {
        var buffer = new byte[ControlWriter.HeaderBytes];
        _ = new ControlWriter(buffer, ControlOpCode.Shutdown, correlationId);
        return buffer;
    }

    /// <summary>força: 0 = emitResyncFrame (mapa), 1 = resyncVirtual.</summary>
    public static byte[] Resync(uint correlationId, uint contextId, byte force)
    {
        var buffer = new byte[ControlWriter.HeaderBytes + sizeof(uint) + sizeof(byte)];
        var writer = new ControlWriter(buffer, ControlOpCode.Resync, correlationId);
        writer.WriteUInt32(contextId);
        writer.WriteUInt8(force);
        return buffer;
    }
}
