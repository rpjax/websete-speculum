namespace Speculum.Api.Configurations.Models.Hosting;

public sealed class HostingConfiguration
{
    public string DefaultCertificateEmail { get; init; } = "";
    public IReadOnlyList<DomainConfiguration> Domains { get; init; } = Array.Empty<DomainConfiguration>();
}