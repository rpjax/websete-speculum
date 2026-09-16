using System.Text;
using System.Text.Json.Serialization;

namespace Speculum.Supervisor.Wire;

/// <summary>
/// Decode Kind 0x05 (SpeculumTelemetry) — mora no supervisor para lab e Live
/// reutilizarem. Supervisor relay continua cego; só o consumidor parseia.
/// </summary>
public static class CatalogTelemetry
{
    public const int WireVersion = 2;

    public enum Catalog : ushort
    {
        FrameEmitted = 1,
        ResyncRequested = 2,
        ResyncCompleted = 3,
        ResyncFailed = 4,
        ProducerFault = 5,
        InputAdmitted = 6,
        InputRejected = 7,
    }

    public static object? TryDecode(uint contextId, ReadOnlySpan<byte> payload)
    {
        if (payload.Length < 2)
        {
            return null;
        }

        var catalog = (Catalog)BitConverter.ToUInt16(payload[..2]);
        var body = payload[2..];
        var t = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        return catalog switch
        {
            Catalog.FrameEmitted when body.Length >= 37 => DecodeFrameEmitted(contextId, body, t),
            Catalog.ResyncRequested when body.Length >= 1 => new ResyncRequestedMessage
            {
                V = WireVersion,
                ContextId = (int)contextId,
                Kind = "resyncRequested",
                T = t,
                Force = body[0],
            },
            Catalog.ResyncCompleted when body.Length >= 2 => new ResyncCompletedMessage
            {
                V = WireVersion,
                ContextId = (int)contextId,
                Kind = "resyncCompleted",
                T = t,
                Force = body[0],
                Ok = body[1] != 0,
            },
            Catalog.ResyncFailed when body.Length >= 2 => new ResyncFailedMessage
            {
                V = WireVersion,
                ContextId = (int)contextId,
                Kind = "resyncFailed",
                T = t,
                Force = body[0],
                Ok = body[1] != 0,
            },
            Catalog.ProducerFault => DecodeProducerFault(contextId, body, t),
            Catalog.InputAdmitted when body.Length >= 1 => new InputMessage
            {
                V = WireVersion,
                ContextId = (int)contextId,
                Kind = "inputAdmitted",
                T = t,
                InputType = body[0],
            },
            Catalog.InputRejected when body.Length >= 1 => new InputMessage
            {
                V = WireVersion,
                ContextId = (int)contextId,
                Kind = "inputRejected",
                T = t,
                InputType = body[0],
            },
            _ => null,
        };
    }

    private static FrameEmittedMessage DecodeFrameEmitted(uint contextId, ReadOnlySpan<byte> body, long t)
    {
        return new FrameEmittedMessage
        {
            V = WireVersion,
            ContextId = (int)contextId,
            Kind = "frameEmitted",
            T = t,
            Sequence = BitConverter.ToUInt32(body[0..4]),
            Generation = BitConverter.ToUInt32(body[4..8]),
            Bytes = BitConverter.ToUInt32(body[8..12]),
            OpCount = BitConverter.ToUInt32(body[12..16]),
            TableSize = BitConverter.ToUInt32(body[16..20]),
            IdentitySize = BitConverter.ToUInt32(body[20..24]),
            BuildMs = BitConverter.ToUInt32(body[24..28]),
            EncodeMs = BitConverter.ToUInt32(body[28..32]),
            Dropped = body.Length >= 36 ? BitConverter.ToUInt32(body[32..36]) : 0,
            Resync = body.Length >= 37 && body[36] != 0,
            PartCount = 1,
        };
    }

    private static object? DecodeProducerFault(uint contextId, ReadOnlySpan<byte> body, long t)
    {
        // Wire: u32 codeLen + code + u32 phaseLen + phase
        if (body.Length < 8)
        {
            return null;
        }

        var codeLen = BitConverter.ToInt32(body[0..4]);
        if (codeLen < 0 || 4 + codeLen + 4 > body.Length)
        {
            return null;
        }

        var code = Encoding.UTF8.GetString(body.Slice(4, codeLen));
        var phaseLen = BitConverter.ToInt32(body.Slice(4 + codeLen, 4));
        if (phaseLen < 0 || 8 + codeLen + phaseLen > body.Length)
        {
            return null;
        }

        var phase = Encoding.UTF8.GetString(body.Slice(8 + codeLen, phaseLen));
        return new ProducerFaultMessage
        {
            V = WireVersion,
            ContextId = (int)contextId,
            Kind = "producerFault",
            T = t,
            ErrorCode = code,
            Phase = phase,
        };
    }

    public sealed class FrameEmittedMessage
    {
        [JsonPropertyName("v")]
        public int V { get; init; }

        [JsonPropertyName("contextId")]
        public int ContextId { get; init; }

        [JsonPropertyName("kind")]
        public string Kind { get; init; } = "";

        [JsonPropertyName("t")]
        public long T { get; init; }

        [JsonPropertyName("generation")]
        public uint Generation { get; init; }

        [JsonPropertyName("sequence")]
        public uint Sequence { get; init; }

        [JsonPropertyName("bytes")]
        public uint Bytes { get; init; }

        [JsonPropertyName("opCount")]
        public uint OpCount { get; init; }

        [JsonPropertyName("tableSize")]
        public uint TableSize { get; init; }

        [JsonPropertyName("identitySize")]
        public uint IdentitySize { get; init; }

        [JsonPropertyName("buildMs")]
        public uint BuildMs { get; init; }

        [JsonPropertyName("encodeMs")]
        public uint EncodeMs { get; init; }

        [JsonPropertyName("dropped")]
        public uint Dropped { get; init; }

        [JsonPropertyName("resync")]
        public bool Resync { get; init; }

        [JsonPropertyName("partCount")]
        public int PartCount { get; init; }
    }

    public sealed class ResyncRequestedMessage
    {
        [JsonPropertyName("v")]
        public int V { get; init; }

        [JsonPropertyName("contextId")]
        public int ContextId { get; init; }

        [JsonPropertyName("kind")]
        public string Kind { get; init; } = "";

        [JsonPropertyName("t")]
        public long T { get; init; }

        [JsonPropertyName("force")]
        public byte Force { get; init; }
    }

    public sealed class ResyncCompletedMessage
    {
        [JsonPropertyName("v")]
        public int V { get; init; }

        [JsonPropertyName("contextId")]
        public int ContextId { get; init; }

        [JsonPropertyName("kind")]
        public string Kind { get; init; } = "";

        [JsonPropertyName("t")]
        public long T { get; init; }

        [JsonPropertyName("force")]
        public byte Force { get; init; }

        [JsonPropertyName("ok")]
        public bool Ok { get; init; }
    }

    public sealed class ResyncFailedMessage
    {
        [JsonPropertyName("v")]
        public int V { get; init; }

        [JsonPropertyName("contextId")]
        public int ContextId { get; init; }

        [JsonPropertyName("kind")]
        public string Kind { get; init; } = "";

        [JsonPropertyName("t")]
        public long T { get; init; }

        [JsonPropertyName("force")]
        public byte Force { get; init; }

        [JsonPropertyName("ok")]
        public bool Ok { get; init; }
    }

    public sealed class ProducerFaultMessage
    {
        [JsonPropertyName("v")]
        public int V { get; init; }

        [JsonPropertyName("contextId")]
        public int ContextId { get; init; }

        [JsonPropertyName("kind")]
        public string Kind { get; init; } = "";

        [JsonPropertyName("t")]
        public long T { get; init; }

        [JsonPropertyName("errorCode")]
        public string ErrorCode { get; init; } = "";

        [JsonPropertyName("phase")]
        public string Phase { get; init; } = "";
    }

    public sealed class InputMessage
    {
        [JsonPropertyName("v")]
        public int V { get; init; }

        [JsonPropertyName("contextId")]
        public int ContextId { get; init; }

        [JsonPropertyName("kind")]
        public string Kind { get; init; } = "";

        [JsonPropertyName("t")]
        public long T { get; init; }

        [JsonPropertyName("inputType")]
        public byte InputType { get; init; }
    }
}
