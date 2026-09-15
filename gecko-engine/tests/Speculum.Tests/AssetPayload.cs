using System.Buffers.Binary;
using System.Text;

namespace Speculum.Tests;

/// <summary>
/// Payload Kind 0x06: streamId u32, phase u8, offset u64, len u32 + bytes (offset 17).
/// </summary>
public static class AssetPayload
{
    public const byte PhaseRequest = 0;
    public const byte PhaseChunk = 1;
    public const byte PhaseDenied = 2;
    public const byte PhaseComplete = 3;

    public const int HeaderBytes = sizeof(uint) + sizeof(byte) + sizeof(ulong) + sizeof(uint);

    public static byte[] EncodeRequest(byte dest, string url, string range)
    {
        var urlBytes = Encoding.UTF8.GetBytes(url);
        var rangeBytes = Encoding.UTF8.GetBytes(range);
        var inner = new byte[1 + 4 + urlBytes.Length + 4 + rangeBytes.Length];
        inner[0] = dest;
        BinaryPrimitives.WriteUInt32LittleEndian(inner.AsSpan(1), (uint)urlBytes.Length);
        urlBytes.CopyTo(inner.AsSpan(5));
        BinaryPrimitives.WriteUInt32LittleEndian(inner.AsSpan(5 + urlBytes.Length), (uint)rangeBytes.Length);
        rangeBytes.CopyTo(inner.AsSpan(9 + urlBytes.Length));
        return Encode(1, PhaseRequest, 0, inner);
    }

    public static byte[] Encode(uint streamId, byte phase, ulong offset, ReadOnlySpan<byte> data)
    {
        var buffer = new byte[HeaderBytes + data.Length];
        BinaryPrimitives.WriteUInt32LittleEndian(buffer.AsSpan(0), streamId);
        buffer[4] = phase;
        BinaryPrimitives.WriteUInt64LittleEndian(buffer.AsSpan(5), offset);
        BinaryPrimitives.WriteUInt32LittleEndian(buffer.AsSpan(13), (uint)data.Length);
        data.CopyTo(buffer.AsSpan(HeaderBytes));
        return buffer;
    }

    public static (uint StreamId, byte Phase, ulong Offset, byte[] Data) Decode(ReadOnlySpan<byte> payload)
    {
        if (payload.Length < HeaderBytes)
        {
            throw new InvalidDataException("asset curto");
        }

        var streamId = BinaryPrimitives.ReadUInt32LittleEndian(payload);
        var phase = payload[4];
        var offset = BinaryPrimitives.ReadUInt64LittleEndian(payload[5..]);
        var len = checked((int)BinaryPrimitives.ReadUInt32LittleEndian(payload[13..]));
        if (payload.Length < HeaderBytes + len)
        {
            throw new InvalidDataException("asset truncado");
        }

        return (streamId, phase, offset, payload.Slice(HeaderBytes, len).ToArray());
    }
}
