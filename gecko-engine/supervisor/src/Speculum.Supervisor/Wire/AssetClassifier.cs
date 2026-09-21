using System.Buffers.Binary;
using System.Text;

namespace Speculum.Supervisor.Wire;

/// <summary>
/// Destino do pedido, não o primeiro byte do corpo. Dúvida = recusa.
/// </summary>
public enum AssetDest : byte
{
    Unknown = 0,
    Image = 1,
    Font = 2,
    Audio = 3,
    Video = 4,
    Hls = 5,
    Html = 10,
    Js = 11,
    Css = 12,
    Xhr = 13,
    Sse = 14,
    Ws = 15,
}

public static class AssetClassifier
{
    public static bool CanExit(AssetDest dest) =>
        dest is AssetDest.Image or AssetDest.Font or AssetDest.Audio or AssetDest.Video or AssetDest.Hls;

    public static AssetDest FromFetchDestination(string? destination)
    {
        return destination switch
        {
            "image" => AssetDest.Image,
            "font" => AssetDest.Font,
            "audio" => AssetDest.Audio,
            "video" => AssetDest.Video,
            "document" or "frame" or "iframe" or "embed" or "object" => AssetDest.Html,
            "script" => AssetDest.Js,
            "style" => AssetDest.Css,
            "report" or "manifest" => AssetDest.Html,
            "websocket" => AssetDest.Ws,
            "" or null => AssetDest.Xhr,
            _ => AssetDest.Unknown,
        };
    }

    public static byte[] EncodeRequestData(AssetDest dest, string url, string range = "")
    {
        var urlBytes = Encoding.UTF8.GetBytes(url);
        var rangeBytes = Encoding.UTF8.GetBytes(range);
        var buffer = new byte[1 + sizeof(uint) + urlBytes.Length + sizeof(uint) + rangeBytes.Length];
        buffer[0] = (byte)dest;
        BinaryPrimitives.WriteUInt32LittleEndian(buffer.AsSpan(1), (uint)urlBytes.Length);
        urlBytes.CopyTo(buffer.AsSpan(5));
        BinaryPrimitives.WriteUInt32LittleEndian(buffer.AsSpan(5 + urlBytes.Length), (uint)rangeBytes.Length);
        rangeBytes.CopyTo(buffer.AsSpan(9 + urlBytes.Length));
        return buffer;
    }

    public static bool TryDecodeRequestData(
        ReadOnlySpan<byte> data, out AssetDest dest, out string url, out string range)
    {
        dest = AssetDest.Unknown;
        url = "";
        range = "";
        if (data.Length < 1 + sizeof(uint))
        {
            return false;
        }

        dest = (AssetDest)data[0];
        var urlLen = checked((int)BinaryPrimitives.ReadUInt32LittleEndian(data[1..]));
        if (urlLen < 0 || data.Length < 5 + urlLen + sizeof(uint))
        {
            return false;
        }

        url = Encoding.UTF8.GetString(data.Slice(5, urlLen));
        var rangeLen = checked((int)BinaryPrimitives.ReadUInt32LittleEndian(data[(5 + urlLen)..]));
        if (rangeLen < 0 || data.Length < 9 + urlLen + rangeLen)
        {
            return false;
        }

        range = Encoding.UTF8.GetString(data.Slice(9 + urlLen, rangeLen));
        return true;
    }
}
