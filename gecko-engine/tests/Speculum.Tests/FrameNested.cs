using System.Buffers.Binary;

namespace Speculum.Tests;

/// <summary>
/// Lê <c>childScopeId</c> dos NODE_NEW de host aninhado (bit 7 do ns).
/// Mesmo layout de <c>decode.ts</c> §4.2.
/// </summary>
public static class FrameNested
{
    public const byte OpNodeNew = 0x20;
    public const byte OpInsert = 0x40;
    public const byte OpCheck = 0x01;
    public const byte KindElement = 1;
    public const byte NestedHostBit = 0x80;

    public static bool TryReadChildScopes(ReadOnlySpan<byte> frame, out uint[] scopes, out string? problem)
    {
        scopes = [];
        if (!FrameStrings.TryReadLocal(frame, out _, out problem))
        {
            return false;
        }

        var offset = SealedFrame.PrefixBytes;
        if (!TryU32(frame, ref offset, out var strCount))
        {
            problem = "strCount truncado";
            return false;
        }

        for (var i = 0; i < strCount; i++)
        {
            if (!TryU32(frame, ref offset, out var len) || offset + (int)len > frame.Length)
            {
                problem = $"string {i} truncada";
                return false;
            }

            offset += (int)len;
        }

        if (!TryU32(frame, ref offset, out var opCount))
        {
            problem = "opCount truncado";
            return false;
        }

        var found = new List<uint>();
        for (var i = 0; i < opCount; i++)
        {
            if (offset >= frame.Length)
            {
                problem = $"op {i} truncado";
                return false;
            }

            var code = frame[offset++];
            if (code == OpNodeNew)
            {
                if (!TryU32(frame, ref offset, out _) || offset >= frame.Length)
                {
                    problem = $"NODE_NEW {i} truncado";
                    return false;
                }

                var kind = frame[offset++];
                if (kind == KindElement)
                {
                    if (offset >= frame.Length)
                    {
                        problem = $"NODE_NEW element {i} sem ns";
                        return false;
                    }

                    var ns = frame[offset++];
                    if ((ns & 0x0f) == 4)
                    {
                        if (!TryU32(frame, ref offset, out _))
                        {
                            problem = $"NODE_NEW custom uri {i}";
                            return false;
                        }
                    }

                    if (!TryU32(frame, ref offset, out _) || !TryU16(frame, ref offset, out var attrCount))
                    {
                        problem = $"NODE_NEW attrs {i}";
                        return false;
                    }

                    for (var a = 0; a < attrCount; a++)
                    {
                        if (!TryU32(frame, ref offset, out _) || !TryU32(frame, ref offset, out _))
                        {
                            problem = $"NODE_NEW attr {i}.{a}";
                            return false;
                        }
                    }

                    if ((ns & NestedHostBit) != 0)
                    {
                        if (!TryU32(frame, ref offset, out var childScope))
                        {
                            problem = $"NODE_NEW childScope {i}";
                            return false;
                        }

                        found.Add(childScope);
                    }
                }
                else if (kind is 2 or 3 or 6)
                {
                    if (!TryU32(frame, ref offset, out _))
                    {
                        problem = $"NODE_NEW leaf {i}";
                        return false;
                    }
                }
                else
                {
                    problem = $"NODE_NEW kind {kind} nao varrido";
                    return false;
                }
            }
            else if (code == OpInsert)
            {
                if (!TryU32(frame, ref offset, out _) || !TryU32(frame, ref offset, out _) ||
                    !TryU16(frame, ref offset, out var n))
                {
                    problem = $"INSERT {i}";
                    return false;
                }

                offset += n * 4;
            }
            else if (code == OpCheck)
            {
                offset += 1 + 4 + 4 + 8;
            }
            else if (code == 0x41)
            {
                if (!TryU32(frame, ref offset, out _) || !TryU16(frame, ref offset, out var n))
                {
                    problem = $"REMOVE {i}";
                    return false;
                }

                offset += n * 4;
            }
            else if (code == 0x60)
            {
                if (!TryU32(frame, ref offset, out _) || !TryU16(frame, ref offset, out var n))
                {
                    problem = $"ATTR_SET {i}";
                    return false;
                }

                offset += n * 8;
            }
            else if (code == 0x61)
            {
                if (!TryU32(frame, ref offset, out _) || !TryU16(frame, ref offset, out var n))
                {
                    problem = $"ATTR_DEL {i}";
                    return false;
                }

                offset += n * 4;
            }
            else if (code == 0x62 || code == 0x21)
            {
                if (code == 0x62)
                {
                    offset += 8;
                }
                else if (!TryU16(frame, ref offset, out var n))
                {
                    problem = $"NODE_DROP {i}";
                    return false;
                }
                else
                {
                    offset += n * 4;
                }
            }
            else if (code == 0xa0)
            {
                offset += 4 + 1 + 4 + 4;
            }
            else if (code is 0xa1 or 0xa2)
            {
                if (!TryU16(frame, ref offset, out var n))
                {
                    problem = $"SHEET {i}";
                    return false;
                }

                offset += n * 4;
            }
            else if (code == 0xa3)
            {
                offset += 16;
            }
            else if (code == 0xa4)
            {
                if (!TryU32(frame, ref offset, out _) || !TryU16(frame, ref offset, out var n))
                {
                    problem = $"RULE_DROP {i}";
                    return false;
                }

                offset += n * 4;
            }
            else if (code == 0xa5)
            {
                offset += 8;
            }
            else
            {
                problem = $"opcode 0x{code:x2} nao varrido";
                return false;
            }
        }

        scopes = found.ToArray();
        problem = null;
        return true;
    }

    public static bool HasChildScope(ReadOnlySpan<byte> frame, uint contextId)
    {
        return TryReadChildScopes(frame, out var scopes, out _) &&
               Array.Exists(scopes, s => s == contextId);
    }

    private static bool TryU16(ReadOnlySpan<byte> frame, ref int offset, out ushort value)
    {
        if (offset + 2 > frame.Length)
        {
            value = 0;
            return false;
        }

        value = BinaryPrimitives.ReadUInt16LittleEndian(frame[offset..]);
        offset += 2;
        return true;
    }

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
