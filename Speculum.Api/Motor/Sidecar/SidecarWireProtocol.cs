using System.Buffers.Binary;
using System.Text;

namespace Speculum.Api.Motor.Sidecar;

/// <summary>
/// W7S sidecar wire protocol — binary opcodes and encoders mirrored from
/// <c>sidecar/src/protocol/wire-protocol.ts</c>.
/// </summary>
public static class SidecarWireProtocol
{
    public const byte MsgUrl         = 0x04;
    public const byte MsgConsole     = 0x05;
    public const byte MsgEvalResult  = 0x06;
    public const byte MsgH264        = 0x07;
    public const byte MsgScreencast  = 0x08;
    public const byte MsgStatus      = 0x09;
    public const byte MsgRedirect    = 0x0A;

    public static byte[] EncodeScreencastFrame(ReadOnlySpan<byte> jpeg)
    {
        var buf = new byte[1 + jpeg.Length];
        buf[0] = MsgScreencast;
        jpeg.CopyTo(buf.AsSpan(1));
        return buf;
    }

    public static byte[] EncodeConsoleMessage(byte level, string text)
    {
        var textBytes = Encoding.UTF8.GetBytes(text);
        var buf = new byte[1 + 1 + 4 + textBytes.Length];
        buf[0] = MsgConsole;
        buf[1] = level;
        BinaryPrimitives.WriteUInt32LittleEndian(buf.AsSpan(2), (uint)textBytes.Length);
        textBytes.CopyTo(buf.AsSpan(6));
        return buf;
    }

    public static byte[] EncodeEvalResult(uint id, bool ok, string value)
    {
        var valueBytes = Encoding.UTF8.GetBytes(value);
        var buf = new byte[1 + 4 + 1 + 4 + valueBytes.Length];
        var off = 0;
        buf[off++] = MsgEvalResult;
        BinaryPrimitives.WriteUInt32LittleEndian(buf.AsSpan(off), id);
        off += 4;
        buf[off++] = (byte)(ok ? 1 : 0);
        BinaryPrimitives.WriteUInt32LittleEndian(buf.AsSpan(off), (uint)valueBytes.Length);
        off += 4;
        valueBytes.CopyTo(buf.AsSpan(off));
        return buf;
    }

    public static byte[] EncodeUrlUpdate(string url)
    {
        var urlBytes = Encoding.UTF8.GetBytes(url);
        var buf = new byte[1 + 4 + urlBytes.Length];
        buf[0] = MsgUrl;
        BinaryPrimitives.WriteUInt32LittleEndian(buf.AsSpan(1), (uint)urlBytes.Length);
        urlBytes.CopyTo(buf.AsSpan(5));
        return buf;
    }

    public static byte[] EncodeStatusFrame(string json)
    {
        var jsonBytes = Encoding.UTF8.GetBytes(json);
        var buf = new byte[1 + 4 + jsonBytes.Length];
        buf[0] = MsgStatus;
        BinaryPrimitives.WriteUInt32LittleEndian(buf.AsSpan(1), (uint)jsonBytes.Length);
        jsonBytes.CopyTo(buf.AsSpan(5));
        return buf;
    }

    public static byte[] EncodeRedirectFrame(string url)
        => EncodeLengthPrefixedUtf8(MsgRedirect, url);

    private static byte[] EncodeLengthPrefixedUtf8(byte opcode, string text)
    {
        var bytes = Encoding.UTF8.GetBytes(text);
        var buf = new byte[1 + 4 + bytes.Length];
        buf[0] = opcode;
        BinaryPrimitives.WriteUInt32LittleEndian(buf.AsSpan(1), (uint)bytes.Length);
        bytes.CopyTo(buf.AsSpan(5));
        return buf;
    }
}
