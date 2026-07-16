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
    public void BuildCertificatesYaml_EmitsHttpResolverForApex()
    {
        var yaml = TraefikYamlBuilder.BuildCertificatesYaml(new HostingOptions
        {
            AcmeEmail = "ops@example.com",
            Profiles =
            [
                new HostingProfileOptions { Domain = "speculum.test", SubdomainMirroringEnabled = false },
            ],
        });
        Assert.Contains("certificatesResolvers:", yaml);
        Assert.Contains("entryPoints:", yaml);
        Assert.Contains("providers:", yaml);
        Assert.Contains("network: speculum", yaml);
        Assert.Contains("le:", yaml);
        Assert.Contains("httpChallenge:", yaml);
        Assert.Contains("ops@example.com", yaml);
        Assert.DoesNotContain("dnsChallenge", yaml);
    }

    [Fact]
    public void ProductionEdgeProfile_WritesStaticCertificatesFile()
    {
        var root = Path.Combine(Path.GetTempPath(), "speculum-edge-" + Guid.NewGuid().ToString("N"));
        var dynamic = Path.Combine(root, "dynamic");
        Directory.CreateDirectory(dynamic);

        try
        {
            var context = new EdgeMaterializationContext
            {
                TraefikRoot = root,
                DynamicDir = dynamic,
                CertsDir = Path.Combine(root, "certs"),
                Hosting = new HostingOptions
                {
                    AcmeEmail = "ops@example.com",
                    Profiles =
                    [
                        new HostingProfileOptions { Domain = "betano.digital", SubdomainMirroringEnabled = false },
                    ],
                },
                Forwarding = new ForwardingOptions { Host = "www.eneba.com", Domains = ["eneba.com"] },
            };

            new ProductionEdgeProfile().Materialize(context);

            var staticPath = Path.Combine(root, "traefik.static.yml");
            Assert.True(File.Exists(staticPath));
            var staticYaml = File.ReadAllText(staticPath);
            Assert.Contains("certificatesResolvers:", staticYaml);
            Assert.Contains("certResolver: le", File.ReadAllText(Path.Combine(dynamic, "motor.yml")));
            Assert.False(File.Exists(Path.Combine(dynamic, "certificates.yml")));
        }
        finally
        {
            try { Directory.Delete(root, recursive: true); } catch { /* ignore */ }
        }
    }
}
