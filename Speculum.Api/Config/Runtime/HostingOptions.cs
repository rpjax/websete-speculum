namespace Speculum.Api.Config.Runtime;

public sealed class HostingOptions
{
    public string AcmeEmail { get; init; } = "";
    public IReadOnlyList<HostingProfileOptions> Profiles { get; init; } = [];
}

public sealed class HostingProfileOptions
{
    public string Domain { get; init; } = "";
    public string? AcmeEmail { get; init; }
    public bool SubdomainMirroringEnabled { get; init; }
    public EdgeTlsOptions? EdgeTls { get; init; }
}

public sealed class HostingProfileStatus
{
    public string Domain { get; init; } = "";
    public bool SubdomainMirroringEnabled { get; init; }
    public bool MirroringOperational { get; init; }
    public IReadOnlyList<string> Missing { get; init; } = [];
}
