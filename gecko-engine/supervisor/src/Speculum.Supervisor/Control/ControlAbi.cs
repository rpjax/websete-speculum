using System.Buffers.Binary;
using System.Text;

namespace Speculum.Supervisor.Control;

/// <summary>
/// Opcodes do plano de controle (doc 18 §3).
///
/// Faixas separadas por sentido para que erro de direção seja detectável em vez
/// de silencioso: 0x01xx é comando (supervisor -> browser), 0x02xx é evento
/// (browser -> supervisor).
/// </summary>
public enum ControlOpCode : ushort
{
    // supervisor -> browser
    ContextCreate = 0x0101,
    ContextDestroy = 0x0102,
    Navigate = 0x0103,
    Reload = 0x0104,
    Stop = 0x0105,
    HistoryGo = 0x0106,
    ViewportSet = 0x0107,
    Input = 0x0108,
    Resync = 0x0109,
    DialogRespond = 0x010a,
    PermissionRespond = 0x010b,
    DownloadRespond = 0x010c,
    HaltClocks = 0x010d,
    ResumeClocks = 0x010e,
    FlushFrame = 0x010f,
    Snapshot = 0x0110,
    Shutdown = 0x01ff,

    // browser -> supervisor
    Ready = 0x0201,
    Heartbeat = 0x0202,
    ContextCreated = 0x0203,
    ContextDestroyed = 0x0204,
    Navigated = 0x0205,
    LoadStateChanged = 0x0206,
    DialogRequested = 0x0207,
    PermissionRequested = 0x0208,
    DownloadRequested = 0x0209,
    SnapshotServed = 0x020a,
    Fault = 0x02ff,
}

/// <summary>
/// Escrita do payload de controle. Little-endian; strings em UTF-8 prefixadas
/// por tamanho, sem terminador nulo (doc 18 §2).
/// </summary>
public ref struct ControlWriter
{
    private readonly Span<byte> _buffer;
    private int _position;

    public ControlWriter(Span<byte> buffer, ControlOpCode opCode, uint correlationId)
    {
        _buffer = buffer;
        _position = 0;
        WriteUInt16((ushort)opCode);
        WriteUInt32(correlationId);
    }

    public readonly int Length => _position;

    public void WriteUInt8(byte value) => _buffer[_position++] = value;

    public void WriteBool(bool value) => WriteUInt8(value ? (byte)1 : (byte)0);

    public void WriteUInt16(ushort value)
    {
        BinaryPrimitives.WriteUInt16LittleEndian(_buffer[_position..], value);
        _position += sizeof(ushort);
    }

    public void WriteInt32(int value)
    {
        BinaryPrimitives.WriteInt32LittleEndian(_buffer[_position..], value);
        _position += sizeof(int);
    }

    public void WriteUInt32(uint value)
    {
        BinaryPrimitives.WriteUInt32LittleEndian(_buffer[_position..], value);
        _position += sizeof(uint);
    }

    public void WriteUInt64(ulong value)
    {
        BinaryPrimitives.WriteUInt64LittleEndian(_buffer[_position..], value);
        _position += sizeof(ulong);
    }

    public void WriteString(string value)
    {
        var byteCount = Encoding.UTF8.GetByteCount(value);
        WriteUInt32((uint)byteCount);
        Encoding.UTF8.GetBytes(value, _buffer[_position..]);
        _position += byteCount;
    }

    public void WriteBytes(ReadOnlySpan<byte> value)
    {
        WriteUInt32((uint)value.Length);
        value.CopyTo(_buffer[_position..]);
        _position += value.Length;
    }

    /// <summary>Tamanho do cabeçalho da mensagem de controle: opcode + correlação.</summary>
    public const int HeaderBytes = sizeof(ushort) + sizeof(uint);

    public static int SizeOfString(string value) => sizeof(uint) + Encoding.UTF8.GetByteCount(value);

    public static int SizeOfBytes(ReadOnlySpan<byte> value) => sizeof(uint) + value.Length;
}

/// <summary>Leitura do payload de controle. Lança <see cref="InvalidDataException"/> em truncamento.</summary>
public ref struct ControlReader
{
    private readonly ReadOnlySpan<byte> _buffer;
    private int _position;

    public ControlReader(ReadOnlySpan<byte> buffer)
    {
        if (buffer.Length < ControlWriter.HeaderBytes)
        {
            throw new InvalidDataException("mensagem de controle menor que o cabeçalho");
        }

        _buffer = buffer;
        _position = 0;
        OpCode = (ControlOpCode)ReadUInt16();
        CorrelationId = ReadUInt32();
    }

    public ControlOpCode OpCode { get; }

    public uint CorrelationId { get; }

    public byte ReadUInt8()
    {
        Require(sizeof(byte));
        return _buffer[_position++];
    }

    public bool ReadBool() => ReadUInt8() != 0;

    public ushort ReadUInt16()
    {
        Require(sizeof(ushort));
        var value = BinaryPrimitives.ReadUInt16LittleEndian(_buffer[_position..]);
        _position += sizeof(ushort);
        return value;
    }

    public int ReadInt32()
    {
        Require(sizeof(int));
        var value = BinaryPrimitives.ReadInt32LittleEndian(_buffer[_position..]);
        _position += sizeof(int);
        return value;
    }

    public uint ReadUInt32()
    {
        Require(sizeof(uint));
        var value = BinaryPrimitives.ReadUInt32LittleEndian(_buffer[_position..]);
        _position += sizeof(uint);
        return value;
    }

    public ulong ReadUInt64()
    {
        Require(sizeof(ulong));
        var value = BinaryPrimitives.ReadUInt64LittleEndian(_buffer[_position..]);
        _position += sizeof(ulong);
        return value;
    }

    public string ReadString()
    {
        var byteCount = checked((int)ReadUInt32());
        Require(byteCount);
        var value = Encoding.UTF8.GetString(_buffer.Slice(_position, byteCount));
        _position += byteCount;
        return value;
    }

    public byte[] ReadBytes()
    {
        var byteCount = checked((int)ReadUInt32());
        Require(byteCount);
        var value = _buffer.Slice(_position, byteCount).ToArray();
        _position += byteCount;
        return value;
    }

    private readonly void Require(int bytes)
    {
        if (_position + bytes > _buffer.Length)
        {
            throw new InvalidDataException("mensagem de controle truncada");
        }
    }
}
