using System.Buffers.Binary;
using System.Text;
using Speculum.Supervisor.Wire;

namespace Speculum.Api.BrowserClients.Gecko;

internal static class GeckoAssetWire
{
    public static byte[] EncodeRequest(uint streamId, byte dest, string url, string range)
    {
        var urlBytes = Encoding.UTF8.GetBytes(url);
        var rangeBytes = Encoding.UTF8.GetBytes(range ?? "");
        var inner = 1 + 4 + urlBytes.Length + 4 + rangeBytes.Length;
        var body = new byte[4 + 1 + 8 + 4 + inner];
        var o = 0;
        BinaryPrimitives.WriteUInt32LittleEndian(body.AsSpan(o), streamId);
        o += 4;
        body[o++] = 0;
        BinaryPrimitives.WriteUInt64LittleEndian(body.AsSpan(o), 0);
        o += 8;
        BinaryPrimitives.WriteUInt32LittleEndian(body.AsSpan(o), (uint)inner);
        o += 4;
        body[o++] = dest;
        BinaryPrimitives.WriteUInt32LittleEndian(body.AsSpan(o), (uint)urlBytes.Length);
        o += 4;
        urlBytes.CopyTo(body.AsSpan(o));
        o += urlBytes.Length;
        BinaryPrimitives.WriteUInt32LittleEndian(body.AsSpan(o), (uint)rangeBytes.Length);
        o += 4;
        rangeBytes.CopyTo(body.AsSpan(o));

        var envelope = new byte[Envelope.HeaderBytes + body.Length];
        Envelope.WriteHeader(envelope, EnvelopeKind.Asset, 0, body.Length);
        Buffer.BlockCopy(body, 0, envelope, Envelope.HeaderBytes, body.Length);
        return envelope;
    }

    public static void StampContext(byte[] envelope, uint contextId)
    {
        if (envelope.Length >= Envelope.HeaderBytes)
        {
            BinaryPrimitives.WriteUInt32LittleEndian(envelope.AsSpan(1, 4), contextId);
        }
    }

    public static (uint StreamId, byte Phase, byte[] Data)? DecodeBody(ReadOnlySpan<byte> payload)
    {
        if (payload.Length < 17)
        {
            return null;
        }

        var streamId = BinaryPrimitives.ReadUInt32LittleEndian(payload);
        var phase = payload[4];
        var len = (int)BinaryPrimitives.ReadUInt32LittleEndian(payload[13..]);
        if (len < 0 || payload.Length < 17 + len)
        {
            return null;
        }

        var data = payload.Slice(17, len).ToArray();
        return (streamId, phase, data);
    }

    public static byte ClassifyDestination(string? dest)
        => dest switch
        {
            "image" => 1,
            "font" => 2,
            "audio" => 3,
            "video" => 4,
            "document" or "frame" or "iframe" or "embed" or "object" => 10,
            "script" => 11,
            "style" => 12,
            "report" or "manifest" => 10,
            "websocket" => 15,
            "" or null => 13,
            _ => 0,
        };
}
