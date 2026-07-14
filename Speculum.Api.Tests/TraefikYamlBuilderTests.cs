using Speculum.Api.Config.Runtime;
using Speculum.Api.Edge;

namespace Speculum.Api.Tests;

public class TraefikYamlBuilderTests
{
    [Fact]
    public void BuildBootstrapRoutersYaml_IncludesApiAndVhubPrefixes()
    {
        var yaml = TraefikYamlBuilder.BuildBootstrapRoutersYaml();
        Assert.Contains("PathPrefix(`/api`)", yaml);
        Assert.Contains("PathPrefix(`/vhub`)", yaml);
        Assert.Contains("PathPrefix(`/health`)", yaml);
        Assert.Contains("speculum-bootstrap-api", yaml);
    }

    [Fact]
    public void BuildMotorRoutersYaml_EmitsHostRulesForProfiles()
    {
        var yaml = TraefikYamlBuilder.BuildMotorRoutersYaml(new HostingOptions
        {
            Profiles =
            [
                new HostingProfileOptions { Domain = "speculum.test", SubdomainMirroringEnabled = false },
            ],
        });
        Assert.NotNull(yaml);
        Assert.Contains("Host(`speculum.test`)", yaml!);
        Assert.Contains("Host(`www.speculum.test`)", yaml);
    }

    [Fact]
    public void BuildCertificatesYaml_AddsDnsResolverWhenMirroring()
    {
        var yaml = TraefikYamlBuilder.BuildCertificatesYaml(new HostingOptions
        {
            AcmeEmail = "a@b.com",
            Profiles =
            [
                new HostingProfileOptions
                {
                    Domain = "speculum.test",
                    SubdomainMirroringEnabled = true,
                    EdgeTls = new EdgeTlsOptions
                    {
                        Provider = "cloudflare",
                        Email = "a@b.com",
                        ApiToken = "tok",
                    },
                },
            ],
        });
        Assert.Contains("le-dns-", yaml);
        Assert.Contains("dnsChallenge", yaml);
        Assert.Contains("cloudflare", yaml);
    }
}
