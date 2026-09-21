using System.Text.Json.Serialization;

namespace Speculum.Supervisor.Control;

/// <summary>
/// Vocabulário de controle entre supervisor e browser (doc 12).
///
/// Assíncrono com id de correlação: nenhuma mensagem bloqueia a linha. O
/// `Input` sozinho é 60–120 msg/s, e latência de input é a qualidade percebida
/// da projeção inteira — por isso não existe request/response bloqueante aqui.
///
/// O fio da ponte é binário (doc 18). Estes records JSON são vocabulário
/// interno do lab, não o payload do envelope.
/// </summary>
public static class ControlVocabulary
{
    // supervisor -> browser
    public const string ContextCreate = "ContextCreate";
    public const string ContextDestroy = "ContextDestroy";
    public const string Navigate = "Navigate";
    public const string Shutdown = "Shutdown";

    // browser -> supervisor
    public const string Ready = "Ready";
    public const string ContextCreated = "ContextCreated";
    public const string ContextDestroyed = "ContextDestroyed";
    public const string Navigated = "Navigated";
    public const string Fault = "Fault";
}

/// <summary>Cabeçalho comum. `Id` correlaciona comando e resposta.</summary>
public record ControlMessage
{
    [JsonPropertyName("type")]
    public required string Type { get; init; }

    [JsonPropertyName("id")]
    public uint Id { get; init; }
}

public sealed record ContextCreateCommand : ControlMessage
{
    [JsonPropertyName("contextId")]
    public required uint ContextId { get; init; }

    [JsonPropertyName("width")]
    public required int Width { get; init; }

    [JsonPropertyName("height")]
    public required int Height { get; init; }
}

public sealed record NavigateCommand : ControlMessage
{
    [JsonPropertyName("contextId")]
    public required uint ContextId { get; init; }

    [JsonPropertyName("url")]
    public required string Url { get; init; }
}

/// <summary>Evento do browser, lido de forma tolerante: campos ausentes ficam nulos.</summary>
public sealed record BrowserEventMessage
{
    [JsonPropertyName("type")]
    public string? Type { get; init; }

    [JsonPropertyName("id")]
    public uint? Id { get; init; }

    [JsonPropertyName("contextId")]
    public uint? ContextId { get; init; }

    [JsonPropertyName("browsingContextId")]
    public ulong? BrowsingContextId { get; init; }

    [JsonPropertyName("url")]
    public string? Url { get; init; }

    [JsonPropertyName("reason")]
    public string? Reason { get; init; }
}
