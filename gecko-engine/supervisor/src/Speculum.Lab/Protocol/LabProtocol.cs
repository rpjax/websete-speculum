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

    [JsonPropertyName("attempt")]
    public int? Attempt { get; init; }

    [JsonPropertyName("bytes")]
    public string? Bytes { get; init; }

    [JsonPropertyName("telemetry")]
    public JsonElement? Telemetry { get; init; }

    [JsonPropertyName("message")]
    public JsonElement? Message { get; init; }

    [JsonPropertyName("exportDossier")]
    public bool? ExportDossier { get; init; }

    [JsonPropertyName("label")]
    public string? Label { get; init; }

    [JsonPropertyName("desynced")]
    public bool? Desynced { get; init; }

    [JsonPropertyName("applyError")]
    public string? ApplyError { get; init; }

    [JsonPropertyName("armed")]
    public bool? Armed { get; init; }

    [JsonPropertyName("sequence")]
    public uint? Sequence { get; init; }

    [JsonPropertyName("generation")]
    public uint? Generation { get; init; }

    [JsonPropertyName("table")]
    public JsonElement? Table { get; init; }

    [JsonPropertyName("tree")]
    public JsonElement? Tree { get; init; }
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

public sealed record SessionBooted(
    string SessionId,
    string Mode,
    string Url,
    string DossierDir,
    bool CapEvents,
    bool CapMetrics)
{
    [JsonPropertyName("type")]
    public string Type => "session.booted";

    [JsonPropertyName("caps")]
    public object Caps => new { events = CapEvents, metrics = CapMetrics };
}

public sealed record SessionStopped(string SessionId, string Reason, string? DossierDir = null)
{
    [JsonPropertyName("type")]
    public string Type => "session.stopped";
}

public sealed record SessionFault(string SessionId, string Message, string? ErrorCode = null, string? Phase = null)
{
    [JsonPropertyName("type")]
    public string Type => "session.fault";
}

/// <summary>
/// Ack do ViewportSet. ViewportSync só libera o próximo resize depois disto —
/// sem isto o primeiro gesto trava o lockstep (resizeInFlight).
/// </summary>
public sealed record SessionResized(
    bool Applied,
    int Width,
    int Height,
    string? ErrorCode = null,
    string? Message = null)
{
    [JsonPropertyName("type")]
    public string Type => "session.resized";
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

public sealed record GeckoSnapshotServed(
    [property: JsonPropertyName("correlationId")] uint CorrelationId,
    [property: JsonPropertyName("contextId")] uint ContextId,
    [property: JsonPropertyName("sequence")] uint Sequence,
    [property: JsonPropertyName("generation")] uint Generation,
    [property: JsonPropertyName("tableHash")] string TableHash,
    [property: JsonPropertyName("dumpBytes")] string DumpBytes)
{
    [JsonPropertyName("type")]
    public string Type => "gecko.snapshotServed";
}

public sealed record GeckoFault(
    [property: JsonPropertyName("correlationId")] uint CorrelationId,
    [property: JsonPropertyName("contextId")] uint ContextId,
    [property: JsonPropertyName("errorCode")] string ErrorCode,
    [property: JsonPropertyName("phase")] string Phase,
    [property: JsonPropertyName("message")] string Message)
{
    [JsonPropertyName("type")]
    public string Type => "gecko.fault";
}

public sealed record GeckoNavigated(
    [property: JsonPropertyName("contextId")] uint ContextId,
    [property: JsonPropertyName("url")] string Url)
{
    [JsonPropertyName("type")]
    public string Type => "gecko.navigated";
}

public sealed record GeckoContextCreated(
    [property: JsonPropertyName("contextId")] uint ContextId,
    [property: JsonPropertyName("browsingContextId")] ulong BrowsingContextId)
{
    [JsonPropertyName("type")]
    public string Type => "gecko.contextCreated";
}

public sealed record LabStats(
    [property: JsonPropertyName("payload")] object Payload)
{
    [JsonPropertyName("type")]
    public string Type => "stats";
}

public sealed record RequestSnapshotHost(
    [property: JsonPropertyName("contextId")] int ContextId,
    [property: JsonPropertyName("includeNestedPeek")] bool IncludeNestedPeek = false,
    /// <summary>Pedido de dump CSSOM (objeto vazio = liga o probe no client).</summary>
    [property: JsonPropertyName("cssomSheetDump")] object? CssomSheetDump = null,
    /// <summary>Probe multiplano de layout (geometria + attrs/img + CSSOM sheets).</summary>
    [property: JsonPropertyName("layoutRootCause")] bool LayoutRootCause = false)
{
    [JsonPropertyName("type")]
    public string Type => "requestSnapshot";
}

/// <summary>
/// Resultado oficial same-S (Halt→Flush→Snapshot Virtual + requestSnapshot Projected).
/// Um ato; planos para localizar causa de layout/CSSOM/DOM/asset — não telemetria.
/// </summary>
public sealed record LabSameSResult(
    [property: JsonPropertyName("ok")] bool Ok,
    [property: JsonPropertyName("error")] string? Error,
    [property: JsonPropertyName("contextId")] uint ContextId,
    [property: JsonPropertyName("virtualSequence")] uint? VirtualSequence,
    [property: JsonPropertyName("projectedSequence")] uint? ProjectedSequence,
    [property: JsonPropertyName("sameSequence")] bool? SameSequence,
    [property: JsonPropertyName("virtualTableHash")] string? VirtualTableHash,
    [property: JsonPropertyName("projectedTableHash")] string? ProjectedTableHash,
    [property: JsonPropertyName("virtual")] object? Virtual,
    [property: JsonPropertyName("projected")] object? Projected)
{
    [JsonPropertyName("type")]
    public string Type => "lab.sameSResult";
}

public sealed record LabError(string Message, string? Code = null)
{
    [JsonPropertyName("type")]
    public string Type => "error";
}

public sealed record LabTelemetryRelay(object Message)
{
    [JsonPropertyName("type")]
    public string Type => "telemetry";
}
