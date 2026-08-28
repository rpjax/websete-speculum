using System.Buffers.Binary;

namespace Speculum.Api.Presentation.Sessions;

/// <summary>
/// Binary mux for one WebSocket data-stream session.
/// OPEN/DATA/CLOSE carry a streamId; pipe bytes (PipeKind + MessagePack frames) are opaque DATA payloads.
/// </summary>
internal static class DataStreamMux
{
    public const byte OpOpen = 1;
    public const byte OpData = 2;
    public const byte OpClose = 3;

    public const int HeaderBytes = 3; // op + streamId u16 BE

    /// <summary>Server-allocated stream ids use the high bit to avoid colliding with client ids.</summary>
    public const ushort ServerStreamIdBase = 0x8000;

    public static byte[] EncodeOpen(ushort streamId)
    {
        var frame = new byte[HeaderBytes];
        frame[0] = OpOpen;
        BinaryPrimitives.WriteUInt16BigEndian(frame.AsSpan(1), streamId);
        return frame;
    }

    public static byte[] EncodeClose(ushort streamId)
    {
        var frame = new byte[HeaderBytes];
        frame[0] = OpClose;
        BinaryPrimitives.WriteUInt16BigEndian(frame.AsSpan(1), streamId);
        return frame;
    }

    public static byte[] EncodeData(ushort streamId, ReadOnlySpan<byte> payload)
    {
        var frame = new byte[HeaderBytes + payload.Length];
        frame[0] = OpData;
        BinaryPrimitives.WriteUInt16BigEndian(frame.AsSpan(1), streamId);
        payload.CopyTo(frame.AsSpan(HeaderBytes));
        return frame;
    }

    public static bool TryParse(
        ReadOnlySpan<byte> frame,
        out byte op,
        out ushort streamId,
        out ReadOnlySpan<byte> payload)
    {
        op = 0;
        streamId = 0;
        payload = default;
        if (frame.Length < HeaderBytes)
        {
            return false;
        }

        op = frame[0];
        streamId = BinaryPrimitives.ReadUInt16BigEndian(frame.Slice(1, 2));
        payload = frame.Length > HeaderBytes ? frame.Slice(HeaderBytes) : ReadOnlySpan<byte>.Empty;
        return op is OpOpen or OpData or OpClose;
    }
}
