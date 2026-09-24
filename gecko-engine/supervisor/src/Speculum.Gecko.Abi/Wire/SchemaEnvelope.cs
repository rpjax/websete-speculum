using System.Buffers.Binary;
using Speculum.Wire;

namespace Speculum.Supervisor.Wire;

/// <summary>
/// 16-byte schema envelope (speculum.wire.toml). Replaces the Kind/ContextId 9-byte ABI.
/// </summary>
public static class SchemaEnvelope
{
    public const int HeaderBytes = 16;
    public const int MaxPayloadBytes = 64 * 1024 * 1024;

    public static void WriteHeader(
        Span<byte> destination, ushort opcode, uint target, int length, uint correlation)
    {
        if (destination.Length < HeaderBytes)
        {
            throw new ArgumentException("buffer menor que o cabeçalho", nameof(destination));
        }

        if (length is < 0 or > MaxPayloadBytes)
        {
            throw new ArgumentOutOfRangeException(nameof(length));
        }

        BinaryPrimitives.WriteUInt16LittleEndian(destination[0..2], opcode);
        BinaryPrimitives.WriteUInt16LittleEndian(destination[2..4], 0);
        BinaryPrimitives.WriteUInt32LittleEndian(destination[4..8], target);
        BinaryPrimitives.WriteUInt32LittleEndian(destination[8..12], (uint)length);
        BinaryPrimitives.WriteUInt32LittleEndian(destination[12..16], correlation);
    }

    public static (ushort Opcode, uint Target, int Length, uint Correlation) ReadHeader(
        ReadOnlySpan<byte> source)
    {
        if (source.Length < HeaderBytes)
        {
            throw new ArgumentException("buffer menor que o cabeçalho", nameof(source));
        }

        var opcode = BinaryPrimitives.ReadUInt16LittleEndian(source[0..2]);
        var reserved = BinaryPrimitives.ReadUInt16LittleEndian(source[2..4]);
        if (reserved != 0)
        {
            throw new InvalidDataException("envelope.reserved must be zero");
        }

        var target = BinaryPrimitives.ReadUInt32LittleEndian(source[4..8]);
        var length = BinaryPrimitives.ReadUInt32LittleEndian(source[8..12]);
        var correlation = BinaryPrimitives.ReadUInt32LittleEndian(source[12..16]);
        if (length > MaxPayloadBytes)
        {
            throw new InvalidDataException($"payload de {length} bytes excede o limite");
        }

        return (opcode, target, (int)length, correlation);
    }

    public static bool TryReadComplete(
        ReadOnlySpan<byte> source, ushort expectedOpcode, out uint target, out int payloadLength,
        out uint correlation)
    {
        target = 0;
        payloadLength = 0;
        correlation = 0;
        if (source.Length < HeaderBytes)
        {
            return false;
        }

        var opcode = BinaryPrimitives.ReadUInt16LittleEndian(source[0..2]);
        if (opcode != expectedOpcode)
        {
            return false;
        }

        var declared = BinaryPrimitives.ReadUInt32LittleEndian(source[8..12]);
        if (declared > MaxPayloadBytes || declared != (uint)(source.Length - HeaderBytes))
        {
            return false;
        }

        target = BinaryPrimitives.ReadUInt32LittleEndian(source[4..8]);
        correlation = BinaryPrimitives.ReadUInt32LittleEndian(source[12..16]);
        payloadLength = (int)declared;
        return true;
    }

    public static byte[] Pack(ushort opcode, uint target, ReadOnlySpan<byte> payload, uint correlation = 0)
    {
        var message = new byte[HeaderBytes + payload.Length];
        WriteHeader(message, opcode, target, payload.Length, correlation);
        payload.CopyTo(message.AsSpan(HeaderBytes));
        return message;
    }

    /// <summary>Schema hash embedded in the gen — must match motor and TS at deploy.</summary>
    public static string SchemaSha256 => SchemaMeta.Sha256;
}
