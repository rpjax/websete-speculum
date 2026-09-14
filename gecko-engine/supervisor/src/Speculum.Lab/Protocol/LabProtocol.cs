using System.Text.Json;
using System.Text.Json.Serialization;

namespace Speculum.Lab.Protocol;

/// <summary>
/// Protocolo de controle do lab, versão 1.
///
/// Estes nomes NÃO são escolha nossa: são o contrato que o cliente projetado já
/// existente (<c>lab/client/main.ts</c>, compilado em <c>static/client.js</c>)
/// fala hoje. Falar esse protocolo é o que permite reaproveitar o cliente de
/// produção sem uma linha alterada — e portanto sem reimplementar o applier,
/// o desync, o resync e o snapshot.
///
/// Referência: sidecar/browser/mirror/projection/lab/host/protocol.ts
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
}

public sealed record SessionHello(string SessionId, string SessionToken)
{
    [JsonPropertyName("type")]
    public string Type => "session.hello";

    [JsonPropertyName("protocolVersion")]
    public int ProtocolVersion => LabProtocol.Version;
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

public sealed record LabError(string Message, string? Code = null)
{
    [JsonPropertyName("type")]
    public string Type => "error";
}
