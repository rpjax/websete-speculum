namespace Speculum.Api.Virtualization;

public sealed class SessionIdentity
{
    public string? ClientToken { get; init; }
    public IReadOnlyDictionary<string, string>? Indexers { get; init; }
}
