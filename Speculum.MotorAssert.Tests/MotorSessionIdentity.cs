using MessagePack;

namespace Speculum.MotorAssert.Tests;

/// <summary>Mirrors Speculum.Api SessionIdentity for MessagePack hub invokes (camelCase keys).</summary>
[MessagePackObject]
public sealed class MotorSessionIdentity
{
    [Key("clientToken")]
    public string? ClientToken { get; init; }

    [Key("correlationId")]
    public string? CorrelationId { get; init; }

    [Key("indexers")]
    public Dictionary<string, string>? Indexers { get; init; }
}
