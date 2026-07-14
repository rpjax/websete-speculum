using MessagePack;

namespace Speculum.Api.Motor.Live;

/// <summary>
/// Hub StartSession identity. MessagePack keys are camelCase to match the web client.
/// </summary>
[MessagePackObject]
public sealed class SessionIdentity
{
    [Key("clientToken")]
    public string? ClientToken { get; init; }

    /// <summary>Optional Act correlation id from the client (diagnostics / Phase 3).</summary>
    [Key("correlationId")]
    public string? CorrelationId { get; init; }

    /// <summary>Concrete dictionary for MessagePack hub round-trip (IReadOnlyDictionary can drop).</summary>
    [Key("indexers")]
    public Dictionary<string, string>? Indexers { get; init; }
}
