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

            ControlOpCode.SnapshotServed =>
                DecodeSnapshotServed(ref reader),

            ControlOpCode.DialogRequested =>
                DecodeDialogRequested(ref reader),

            ControlOpCode.PermissionRequested =>
                DecodeDialogRequested(ref reader),

            ControlOpCode.DownloadRequested =>
                DecodeDialogRequested(ref reader),

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

    private static BrowserEvent DecodeSnapshotServed(ref ControlReader reader)
    {
        reader.ReadUInt32(); // sequence
        reader.ReadUInt32(); // generation
        var contextId = reader.ReadUInt32();
        return new BrowserEvent(
            ControlOpCode.SnapshotServed, reader.CorrelationId, contextId, 0, 0, null);
    }

    private static BrowserEvent DecodeDialogRequested(ref ControlReader reader)
    {
        var contextId = reader.ReadUInt32();
        return new BrowserEvent(reader.OpCode, reader.CorrelationId, contextId, 0, 0, null);
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

    public static byte[] HaltClocks(uint correlationId)
    {
        var buffer = new byte[ControlWriter.HeaderBytes];
        _ = new ControlWriter(buffer, ControlOpCode.HaltClocks, correlationId);
        return buffer;
    }

    public static byte[] ResumeClocks(uint correlationId)
    {
        var buffer = new byte[ControlWriter.HeaderBytes];
        _ = new ControlWriter(buffer, ControlOpCode.ResumeClocks, correlationId);
        return buffer;
    }

    public static byte[] FlushFrame(uint correlationId, uint contextId)
    {
        var buffer = new byte[ControlWriter.HeaderBytes + sizeof(uint)];
        var writer = new ControlWriter(buffer, ControlOpCode.FlushFrame, correlationId);
        writer.WriteUInt32(contextId);
        return buffer;
    }

    public static byte[] Snapshot(uint correlationId, uint contextId)
    {
        var buffer = new byte[ControlWriter.HeaderBytes + sizeof(uint)];
        var writer = new ControlWriter(buffer, ControlOpCode.Snapshot, correlationId);
        writer.WriteUInt32(contextId);
        return buffer;
    }

    public const byte InputDown = 1;
    public const byte InputUp = 2;
    public const byte InputKeyDown = 3;
    public const byte InputKeyUp = 4;
    public const byte InputScrollSet = 5;

    public static byte[] Input(uint correlationId, uint contextId, byte type, ReadOnlySpan<byte> fields)
    {
        var buffer = new byte[ControlWriter.HeaderBytes + sizeof(uint) + sizeof(byte) + fields.Length];
        var writer = new ControlWriter(buffer, ControlOpCode.Input, correlationId);
        writer.WriteUInt32(contextId);
        writer.WriteUInt8(type);
        foreach (var b in fields)
        {
            writer.WriteUInt8(b);
        }

        return buffer;
    }

    public static byte[] InputPointer(
        uint correlationId, uint contextId, byte type, uint nodeId, ushort localX, ushort localY, byte button)
    {
        var buffer = new byte[ControlWriter.HeaderBytes + sizeof(uint) + sizeof(byte) + sizeof(uint)
            + sizeof(ushort) + sizeof(ushort) + sizeof(byte)];
        var writer = new ControlWriter(buffer, ControlOpCode.Input, correlationId);
        writer.WriteUInt32(contextId);
        writer.WriteUInt8(type);
        writer.WriteUInt32(nodeId);
        writer.WriteUInt16(localX);
        writer.WriteUInt16(localY);
        writer.WriteUInt8(button);
        return buffer;
    }

    public static byte[] InputKey(
        uint correlationId, uint contextId, byte type, string key, string code, byte mods)
    {
        var buffer = new byte[ControlWriter.HeaderBytes + sizeof(uint) + sizeof(byte)
            + ControlWriter.SizeOfString(key) + ControlWriter.SizeOfString(code) + sizeof(byte)];
        var writer = new ControlWriter(buffer, ControlOpCode.Input, correlationId);
        writer.WriteUInt32(contextId);
        writer.WriteUInt8(type);
        writer.WriteString(key);
        writer.WriteString(code);
        writer.WriteUInt8(mods);
        return buffer;
    }

    public static byte[] InputScroll(uint correlationId, uint contextId, uint nodeId, ushort fracX, ushort fracY)
    {
        var buffer = new byte[ControlWriter.HeaderBytes + sizeof(uint) + sizeof(byte) + sizeof(uint)
            + sizeof(ushort) + sizeof(ushort)];
        var writer = new ControlWriter(buffer, ControlOpCode.Input, correlationId);
        writer.WriteUInt32(contextId);
        writer.WriteUInt8(InputScrollSet);
        writer.WriteUInt32(nodeId);
        writer.WriteUInt16(fracX);
        writer.WriteUInt16(fracY);
        return buffer;
    }

    public static byte[] ViewportSet(uint correlationId, uint contextId, int width, int height)
    {
        var buffer = new byte[ControlWriter.HeaderBytes + sizeof(uint) + sizeof(int) + sizeof(int)];
        var writer = new ControlWriter(buffer, ControlOpCode.ViewportSet, correlationId);
        writer.WriteUInt32(contextId);
        writer.WriteInt32(width);
        writer.WriteInt32(height);
        return buffer;
    }

    public static byte[] HistoryGo(uint correlationId, uint contextId, int delta)
    {
        var buffer = new byte[ControlWriter.HeaderBytes + sizeof(uint) + sizeof(int)];
        var writer = new ControlWriter(buffer, ControlOpCode.HistoryGo, correlationId);
        writer.WriteUInt32(contextId);
        writer.WriteInt32(delta);
        return buffer;
    }

    public static byte[] Reload(uint correlationId, uint contextId)
    {
        var buffer = new byte[ControlWriter.HeaderBytes + sizeof(uint)];
        var writer = new ControlWriter(buffer, ControlOpCode.Reload, correlationId);
        writer.WriteUInt32(contextId);
        return buffer;
    }

    public static byte[] Stop(uint correlationId, uint contextId)
    {
        var buffer = new byte[ControlWriter.HeaderBytes + sizeof(uint)];
        var writer = new ControlWriter(buffer, ControlOpCode.Stop, correlationId);
        writer.WriteUInt32(contextId);
        return buffer;
    }

    public static byte[] DialogRespond(uint correlationId, uint contextId, uint requestId, ReadOnlySpan<byte> answer)
    {
        var buffer = new byte[ControlWriter.HeaderBytes + sizeof(uint) + sizeof(uint) + ControlWriter.SizeOfBytes(answer)];
        var writer = new ControlWriter(buffer, ControlOpCode.DialogRespond, correlationId);
        writer.WriteUInt32(contextId);
        writer.WriteUInt32(requestId);
        writer.WriteBytes(answer);
        return buffer;
    }

    public static byte[] PermissionRespond(uint correlationId, uint contextId, uint requestId, bool granted)
    {
        var buffer = new byte[ControlWriter.HeaderBytes + sizeof(uint) + sizeof(uint) + sizeof(byte)];
        var writer = new ControlWriter(buffer, ControlOpCode.PermissionRespond, correlationId);
        writer.WriteUInt32(contextId);
        writer.WriteUInt32(requestId);
        writer.WriteBool(granted);
        return buffer;
    }

    public static byte[] DownloadRespond(uint correlationId, uint contextId, uint requestId, bool accepted)
    {
        var buffer = new byte[ControlWriter.HeaderBytes + sizeof(uint) + sizeof(uint) + sizeof(byte)];
        var writer = new ControlWriter(buffer, ControlOpCode.DownloadRespond, correlationId);
        writer.WriteUInt32(contextId);
        writer.WriteUInt32(requestId);
        writer.WriteBool(accepted);
        return buffer;
    }

    public static byte[] SnapshotServed(
        uint correlationId, uint sequence, uint generation, uint contextId, ulong tableHash, ReadOnlySpan<byte> dump)
    {
        var buffer = new byte[
            ControlWriter.HeaderBytes + sizeof(uint) + sizeof(uint) + sizeof(uint) + sizeof(ulong)
            + ControlWriter.SizeOfBytes(dump)];
        var writer = new ControlWriter(buffer, ControlOpCode.SnapshotServed, correlationId);
        writer.WriteUInt32(sequence);
        writer.WriteUInt32(generation);
        writer.WriteUInt32(contextId);
        writer.WriteUInt64(tableHash);
        writer.WriteBytes(dump);
        return buffer;
    }

    public static byte[] DialogRequested(uint correlationId, uint contextId, uint requestId, ReadOnlySpan<byte> description)
    {
        return Requested(ControlOpCode.DialogRequested, correlationId, contextId, requestId, description);
    }

    public static byte[] PermissionRequested(uint correlationId, uint contextId, uint requestId, ReadOnlySpan<byte> description)
    {
        return Requested(ControlOpCode.PermissionRequested, correlationId, contextId, requestId, description);
    }

    public static byte[] DownloadRequested(uint correlationId, uint contextId, uint requestId, ReadOnlySpan<byte> description)
    {
        return Requested(ControlOpCode.DownloadRequested, correlationId, contextId, requestId, description);
    }

    private static byte[] Requested(
        ControlOpCode op, uint correlationId, uint contextId, uint requestId, ReadOnlySpan<byte> description)
    {
        var buffer = new byte[
            ControlWriter.HeaderBytes + sizeof(uint) + sizeof(uint) + ControlWriter.SizeOfBytes(description)];
        var writer = new ControlWriter(buffer, op, correlationId);
        writer.WriteUInt32(contextId);
        writer.WriteUInt32(requestId);
        writer.WriteBytes(description);
        return buffer;
    }
}
