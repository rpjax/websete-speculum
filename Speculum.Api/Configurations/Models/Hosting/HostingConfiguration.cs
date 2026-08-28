namespace Speculum.Api.Configurations.Models.Hosting;

public sealed class HostingConfiguration
{
    public const string SectionName = "Hosting";

    public string DefaultCertificateEmail { get; init; } = "";
    public IReadOnlyList<DomainConfiguration> Domains { get; init; } = Array.Empty<DomainConfiguration>();
}