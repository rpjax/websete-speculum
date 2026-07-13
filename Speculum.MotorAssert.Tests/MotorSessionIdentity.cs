namespace Speculum.MotorAssert.Tests;

/// <summary>Mirrors Speculum.Api SessionIdentity for MessagePack hub invokes.</summary>
public sealed class MotorSessionIdentity
{
    public string? ClientToken { get; init; }
    public string? CorrelationId { get; init; }
    public IReadOnlyDictionary<string, string>? Indexers { get; init; }
}
