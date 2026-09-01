namespace Speculum.Api.Configurations.Models.Hosting;

public sealed class DomainConfiguration
{
    public string Domain { get; init; } = "";
    public string? CertificateEmail { get; init; }
    public bool IsSubdomainMirroringEnabled { get; init; }
    public DnsChallengeConfiguration? DnsChallenge { get; init; }
}
