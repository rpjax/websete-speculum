using System.Buffers.Binary;

namespace Speculum.Tests;

/// <summary>
/// Frame sintético do browser falso (L3).
///
/// O supervisor trata frame como carga opaca: ele roteia pelo contextId DO
/// ENVELOPE e nunca olha dentro. Então o L3 não precisa de um frame de projeção
/// de verdade — precisa de bytes reconhecíveis que provem que o transporte não
/// corrompe e não reordena. Este é o único formato de frame que o L3 conhece,
/// e as duas pontas (o browser falso que emite, o teste que confere) usam ESTE
/// mesmo código. Não há dois formatos que por acaso concordam.
///
/// Layout, little-endian:
/// <code>
///   u8[4]  magic  = "SPKF"
///   u32    contextId   — o contexto que o supervisor alocou; provado ponta a ponta
///   u64    sequence    — estritamente crescente; prova ordem preservada
///   u32    blobLength = 32
///   u8[32] blob        — bytes fixos; prova integridade byte a byte
/// </code>
/// </summary>
public static class FakeFrame
{
    public static readonly byte[] Magic = "SPKF"u8.ToArray();
    public const int BlobLength = 32;
    public const int TotalBytes = 4 + sizeof(uint) + sizeof(ulong) + sizeof(uint) + BlobLength;

    /// <summary>Blob determinístico: 0x00..0x1f. Igual em todo frame.</summary>
    public static byte[] Blob()
    {
        var blob = new byte[BlobLength];
        for (var i = 0; i < BlobLength; i++)
        {
            blob[i] = (byte)i;
        }

        return blob;
    }

    public static byte[] Build(uint contextId, ulong sequence)
    {
        var buffer = new byte[TotalBytes];
        var span = buffer.AsSpan();
        Magic.CopyTo(span);
        BinaryPrimitives.WriteUInt32LittleEndian(span[4..], contextId);
        BinaryPrimitives.WriteUInt64LittleEndian(span[8..], sequence);
        BinaryPrimitives.WriteUInt32LittleEndian(span[16..], BlobLength);
        Blob().CopyTo(span[20..]);
        return buffer;
    }

    public readonly record struct Parsed(bool Ok, uint ContextId, ulong Sequence, byte[] Blob, string? Problem);

    public static Parsed Parse(ReadOnlySpan<byte> frame)
    {
        if (frame.Length != TotalBytes)
        {
            return new Parsed(false, 0, 0, [], $"tamanho {frame.Length}, esperado {TotalBytes}");
        }

        if (!frame[..4].SequenceEqual(Magic))
        {
            return new Parsed(false, 0, 0, [], $"magic {Report.Hex(frame[..4])}, esperado {Report.Hex(Magic)}");
        }

        var contextId = BinaryPrimitives.ReadUInt32LittleEndian(frame[4..]);
        var sequence = BinaryPrimitives.ReadUInt64LittleEndian(frame[8..]);
        var blobLength = BinaryPrimitives.ReadUInt32LittleEndian(frame[16..]);
        if (blobLength != BlobLength)
        {
            return new Parsed(false, contextId, sequence, [], $"blobLength {blobLength}, esperado {BlobLength}");
        }

        return new Parsed(true, contextId, sequence, frame.Slice(20, BlobLength).ToArray(), null);
    }
}
