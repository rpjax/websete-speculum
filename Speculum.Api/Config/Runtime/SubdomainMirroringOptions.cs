namespace Speculum.Api.Config.Runtime;

public sealed class SubdomainMirroringOptions
{
    public bool Enabled { get; init; }
    public EdgeTlsOptions? EdgeTls { get; init; }
}
