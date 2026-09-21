using System.Text.Json.Serialization;

namespace Speculum.Supervisor;

/// <summary>
/// Serialização por geração de código. NativeAOT proíbe reflexão — todo tipo que
/// atravessa JSON precisa estar declarado aqui (doc 11).
/// </summary>
[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(HealthResponse))]
internal sealed partial class SupervisorJsonContext : JsonSerializerContext;

internal sealed record HealthResponse(
    bool Ok,
    int Consumers,
    long FramesDropped,
    bool CapEvents,
    bool CapMetrics);
