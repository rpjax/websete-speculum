using System.Text.Json;
using System.Text.Json.Serialization;

namespace Speculum.Lab.Protocol;

/// <summary>
/// Protocolo de controle do lab, versão 1.
///
/// O lab Gecko serve o mesmo cliente TypeScript, com <c>engine=gecko</c> no hello.
/// Clique e ativo neste fio são ABI, não JSON Chromium.
/// </summary>
public static class LabProtocol
{
    public const int Version = 1;

    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };
}

/// <summary>Envelope mínimo para descobrir o tipo antes de desserializar.</summary>
public sealed record LabClientEnvelope
{
    [JsonPropertyName("type")]
    public string? Type { get; init; }

    [JsonPropertyName("url")]
    public string? Url { get; init; }

    [JsonPropertyName("width")]
    public int? Width { get; init; }

    [JsonPropertyName("height")]
    public int? Height { get; init; }

    [JsonPropertyName("protocolVersion")]
    public int? ProtocolVersion { get; init; }

    [JsonPropertyName("reason")]
    public string? Reason { get; init; }

    [JsonPropertyName("contextId")]
    public uint? ContextId { get; init; }

    [JsonPropertyName("bytes")]
    public string? Bytes { get; init; }
}

public sealed record SessionHello(string SessionId, string SessionToken)
{
    [JsonPropertyName("type")]
    public string Type => "session.hello";

    [JsonPropertyName("protocolVersion")]
    public int ProtocolVersion => LabProtocol.Version;

    [JsonPropertyName("engine")]
    public string Engine => "gecko";
}

public sealed record SessionBooted(string SessionId, string Mode, string Url, string DossierDir)
{
    [JsonPropertyName("type")]
    public string Type => "session.booted";
}

public sealed record SessionStopped(string SessionId, string Reason)
{
    [JsonPropertyName("type")]
    public string Type => "session.stopped";
}

public sealed record SessionFault(string SessionId, string Message, string? ErrorCode = null, string? Phase = null)
{
    [JsonPropertyName("type")]
    public string Type => "session.fault";
}

public sealed record GeckoRequested(
    [property: JsonPropertyName("kind")] string Kind,
    [property: JsonPropertyName("contextId")] uint ContextId,
    [property: JsonPropertyName("requestId")] uint RequestId,
    [property: JsonPropertyName("description")] string Description)
{
    [JsonPropertyName("type")]
    public string Type => "gecko.requested";
}

public sealed record GeckoAsset(
    [property: JsonPropertyName("streamId")] uint StreamId,
    [property: JsonPropertyName("phase")] byte Phase,
    [property: JsonPropertyName("bytes")] string Bytes,
    [property: JsonPropertyName("why")] string Why)
{
    [JsonPropertyName("type")]
    public string Type => "gecko.asset";
}

public sealed record LabError(string Message, string? Code = null)
{
    [JsonPropertyName("type")]
    public string Type => "error";
}
