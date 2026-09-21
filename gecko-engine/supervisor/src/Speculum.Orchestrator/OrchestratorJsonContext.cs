using System.Text.Json.Serialization;

namespace Speculum.Orchestrator;

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(AllocateRequest))]
[JsonSerializable(typeof(AllocateResponse))]
[JsonSerializable(typeof(ReadyResponse))]
[JsonSerializable(typeof(ErrorBody))]
internal sealed partial class OrchestratorJsonContext : JsonSerializerContext;

internal sealed record AllocateRequest(string SessionId, int Width, int Height);

internal sealed record AllocateResponse(string SessionId, string Path);

internal sealed record ReadyResponse(bool Ok, int Pairs, int Capacity, bool FirefoxPresent);

internal sealed record ErrorBody(string Error, string ErrorCode, string Phase);
