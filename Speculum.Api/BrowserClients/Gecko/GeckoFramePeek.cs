using System.Buffers.Binary;
using Speculum.Api.Sessions.Mirror.PageProjection;

namespace Speculum.Api.BrowserClients.Gecko;

internal static class GeckoFramePeek
{
    private const ushort Magic = 0x5050;
    private const int PrefixBytes = 2 + 1 + 1 + 4 + 4 + 4 + 2 + 2 + 8;

    public static PageProjectionFrame? ToFrame(byte[] body, uint envelopeContextId)
    {
        if (body.Length < PrefixBytes)
        {
            return null;
        }

        if (BinaryPrimitives.ReadUInt16LittleEndian(body) != Magic)
        {
            return new PageProjectionFrame
            {
                Sequence = 0,
                Generation = 0,
                Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                Plane = "",
                Operation = "",
                Body = body,
                PartIndex = 0,
                PartCount = 1,
                Flags = 0,
                Version = 2,
                ContextId = envelopeContextId == 0 ? 1 : envelopeContextId,
            };
        }

        var version = body[2];
        var flags = body[3];
        var contextId = BinaryPrimitives.ReadUInt32LittleEndian(body.AsSpan(4));
        var generation = BinaryPrimitives.ReadUInt32LittleEndian(body.AsSpan(8));
        var sequence = BinaryPrimitives.ReadUInt32LittleEndian(body.AsSpan(12));
        var partIndex = BinaryPrimitives.ReadUInt16LittleEndian(body.AsSpan(16));
        var partCount = BinaryPrimitives.ReadUInt16LittleEndian(body.AsSpan(18));
        return new PageProjectionFrame
        {
            Sequence = sequence,
            Generation = generation,
            Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            Plane = "",
            Operation = "",
            Body = body,
            PartIndex = partIndex,
            PartCount = partCount == 0 ? (uint)1 : partCount,
            Flags = flags,
            Version = version == 0 ? 2u : version,
            ContextId = contextId == 0 ? (envelopeContextId == 0 ? 1 : envelopeContextId) : contextId,
        };
    }
}
