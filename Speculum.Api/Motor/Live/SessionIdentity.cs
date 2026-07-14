namespace Speculum.Api.Motor.Live;

public sealed class SessionIdentity
{
    public string? ClientToken { get; init; }
    /// <summary>Optional Act correlation id from the client (diagnostics / Phase 3).</summary>
    public string? CorrelationId { get; init; }
    /// <summary>Concrete dictionary for MessagePack hub round-trip (IReadOnlyDictionary can drop).</summary>
    public Dictionary<string, string>? Indexers { get; init; }
}
