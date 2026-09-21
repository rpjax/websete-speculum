using System.Buffers.Binary;

namespace Speculum.Tests;

/// <summary>
/// Leitor do prefixo selado do frame de projeção REAL (o do produtor no Gecko).
///
/// Diferente do <see cref="FakeFrame"/>: aquele é o frame sintético do L3; este
/// lê o cabeçalho do frame de verdade que sobe do produtor. O L4 usa isto para
/// provar procedência — que o frame veio do contexto pedido, com o contextId
/// carimbado pelo processo pai no offset 4. É exatamente esse carimbo que está
/// sob suspeita (janela chrome vs. contexto do conteúdo), então lê-lo direto do
/// fio é a medida certa.
///
/// Prefixo de 28 bytes, little-endian, sem hash cobrindo o próprio prefixo:
/// <code>
///   u16 magic = 0x5050      (offset 0)
///   u8  version = 2         (offset 2)
///   u8  flags              (offset 3)
///   u32 contextId          (offset 4)   — carimbado pelo pai
///   u32 generation         (offset 8)
///   u32 sequence           (offset 12)
///   u16 partIndex          (offset 16)
///   u16 partCount          (offset 18)
///   u64 preTableHash       (offset 20)
/// </code>
/// </summary>
public static class SealedFrame
{
    public const ushort Magic = 0x5050;
    public const byte WireVersion = 2;
    public const byte ResyncFlag = 0b10;
    public const int PrefixBytes = 28;

    public readonly record struct Header(
        bool Ok,
        ushort Magic,
        byte Version,
        byte Flags,
        uint ContextId,
        uint Generation,
        uint Sequence,
        ushort PartIndex,
        ushort PartCount,
        ulong PreTableHash,
        string? Problem);

    public static Header Parse(ReadOnlySpan<byte> frame)
    {
        if (frame.Length < PrefixBytes)
        {
            return new Header(false, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                $"frame de {frame.Length} bytes, prefixo exige {PrefixBytes}");
        }

        var magic = BinaryPrimitives.ReadUInt16LittleEndian(frame[0..]);
        var version = frame[2];
        var flags = frame[3];
        var contextId = BinaryPrimitives.ReadUInt32LittleEndian(frame[4..]);
        var generation = BinaryPrimitives.ReadUInt32LittleEndian(frame[8..]);
        var sequence = BinaryPrimitives.ReadUInt32LittleEndian(frame[12..]);
        var partIndex = BinaryPrimitives.ReadUInt16LittleEndian(frame[16..]);
        var partCount = BinaryPrimitives.ReadUInt16LittleEndian(frame[18..]);
        var preTableHash = BinaryPrimitives.ReadUInt64LittleEndian(frame[20..]);

        string? problem = null;
        if (magic != Magic)
        {
            problem = $"magic 0x{magic:x4}, esperado 0x{Magic:x4}";
        }
        else if (version != WireVersion)
        {
            problem = $"version {version}, esperado {WireVersion}";
        }

        return new Header(
            problem is null, magic, version, flags, contextId,
            generation, sequence, partIndex, partCount, preTableHash, problem);
    }
}
