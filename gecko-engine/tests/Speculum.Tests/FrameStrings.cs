using System.Buffers.Binary;
using System.Text;

namespace Speculum.Tests;

/// <summary>
/// Lê a tabela local de strings do frame — o mesmo layout de
/// <c>packages/page-projection/src/core/decode.ts</c> (<c>decodeFramePart</c>).
/// O L4 usa isto para afirmar o documento projetado (alpha/bravo) sem reinventar o decoder.
/// </summary>
public static class FrameStrings
{
    // packages/page-projection/src/core/limits.ts
    public const int MaxOpsPerFrame = 65536;
    public const int MaxStrBytes = 1 << 20;

    public static bool TryReadLocal(ReadOnlySpan<byte> frame, out string[] strings, out string? problem)
    {
        strings = [];
        var header = SealedFrame.Parse(frame);
        if (!header.Ok)
        {
            problem = header.Problem;
            return false;
        }

        var offset = SealedFrame.PrefixBytes;
        if (!TryU32(frame, ref offset, out var strCount))
        {
            problem = "strCount truncado";
            return false;
        }

        if (strCount > MaxOpsPerFrame)
        {
            problem = $"strCount {strCount} excede MAX_OPS_PER_FRAME";
            return false;
        }

        var list = new string[strCount];
        for (var i = 0; i < strCount; i++)
        {
            if (!TryU32(frame, ref offset, out var len))
            {
                problem = $"string {i}: comprimento truncado";
                return false;
            }

            if (len > MaxStrBytes)
            {
                problem = $"string {i}: {len} bytes excede MAX_STR_BYTES";
                return false;
            }

            if (offset + (int)len > frame.Length)
            {
                problem = $"string {i}: payload truncado (len={len})";
                return false;
            }

            list[i] = Encoding.UTF8.GetString(frame.Slice(offset, (int)len));
            offset += (int)len;
        }

        strings = list;
        problem = null;
        return true;
    }

    public static bool Contains(string[] strings, string needle) =>
        Array.Exists(strings, s => s.Contains(needle, StringComparison.Ordinal));

    private static bool TryU32(ReadOnlySpan<byte> frame, ref int offset, out uint value)
    {
        if (offset + 4 > frame.Length)
        {
            value = 0;
            return false;
        }

        value = BinaryPrimitives.ReadUInt32LittleEndian(frame[offset..]);
        offset += 4;
        return true;
    }
}
