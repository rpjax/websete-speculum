using System.Text.Json.Serialization;

namespace Speculum.Supervisor.Control;

/// <summary>
/// NativeAOT proíbe reflexão: todo tipo de controle passa por geração de código.
/// </summary>
[JsonSourceGenerationOptions(
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull)]
[JsonSerializable(typeof(ControlMessage))]
[JsonSerializable(typeof(ContextCreateCommand))]
[JsonSerializable(typeof(NavigateCommand))]
[JsonSerializable(typeof(BrowserEventMessage))]
internal sealed partial class ControlJsonContext : JsonSerializerContext;
