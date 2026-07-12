using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Speculum.Api.Config.Bootstrap;
using Speculum.Api.Config.Runtime;
using Speculum.Api.Config.Store;
using Speculum.Api.Hosting;

namespace Speculum.Api.Tests;

public class DomainMatcherTests
{
    [Theory]
    [InlineData("www.olx.com.br", "*.olx.com.br", true)]
    [InlineData("contas.olx.com.br", "*.olx.com.br", true)]
    [InlineData("olx.com.br", "*.olx.com.br", false)]
    [InlineData("olx.com.br", "olx.com.br", true)]
    [InlineData("evil.com", "olx.com.br", false)]
    public void Matches_WildcardAndExact(string host, string pattern, bool expected)
        => Assert.Equal(expected, DomainMatcher.Matches(host, pattern));
}

public class InitialUrlBuilderTests
{
    private static MotorUrlAdapter Adapter()
        => new(new NavigationStateCodec(new byte[32], encrypt: false));

    [Fact]
    public void Build_ApexMode_PreservesPathAndQuery()
    {
        var forwarding = new ForwardingOptions { Host = "www.olx.com.br", Domains = ["*.olx.com.br"] };
        var profile = new HostingProfileOptions { Domain = "speculum.com", SubdomainMirroringEnabled = false };
        var url = InitialUrlBuilder.Build(
            Adapter(), forwarding, "https://speculum.com/cars?q=1", profile, "speculum.com");
        Assert.Equal("https://www.olx.com.br/cars?q=1", url);
    }

    [Fact]
    public void Build_SubdomainMode_MapsHost()
    {
        var forwarding = new ForwardingOptions { Host = "www.olx.com.br", Domains = ["olx.com.br", "*.olx.com.br"] };
        var profile = new HostingProfileOptions { Domain = "speculum.com", SubdomainMirroringEnabled = true };
        var url = InitialUrlBuilder.Build(
            Adapter(), forwarding, "https://www.speculum.com/cars", profile, "speculum.com");
        Assert.Equal("https://www.olx.com.br/cars", url);
    }

    [Fact]
    public void Build_RejectsInvalidClientUrl()
    {
        var forwarding = new ForwardingOptions { Host = "www.olx.com.br", Domains = ["*.olx.com.br"] };
        var profile = new HostingProfileOptions { Domain = "speculum.com" };
        Assert.Throws<ArgumentException>(() =>
            InitialUrlBuilder.Build(Adapter(), forwarding, "not-a-url", profile, "speculum.com"));
    }
}

public class ConfigValidatorTests
{
    [Fact]
    public void Forwarding_RejectsHostNotInDomains()
    {
        var json = JsonDocument.Parse("""
            { "host": "www.other.com", "domains": ["*.olx.com.br"] }
            """).RootElement;

        var ex = Assert.Throws<ConfigValidationException>(() =>
            ConfigValidator.ValidateSection(ConfigSectionKeys.Forwarding, json));

        Assert.Contains(ex.Errors, e => e.Path.Contains("host"));
    }

    [Fact]
    public void Admin_RejectsEmptyApiKey()
    {
        var json = JsonDocument.Parse("""{ "apiKey": "" }""").RootElement;
        Assert.Throws<ConfigValidationException>(() =>
            ConfigValidator.ValidateSection(ConfigSectionKeys.Admin, json));
    }
}

public class SubdomainMirroringEvaluatorTests
{
    private static ForwardingOptions OlxWithWildcard => new()
    {
        Host    = "www.olx.com.br",
        Domains = ["olx.com.br", "*.olx.com.br"],
    };

    [Fact]
    public void WhenDisabled_ReturnsNotOperational()
    {
        var (op, missing) = SubdomainMirroringEvaluator.Evaluate(
            new SubdomainMirroringOptions { Enabled = false },
            OlxWithWildcard,
            "speculum.com");
        Assert.False(op);
        Assert.Empty(missing);
    }

    [Fact]
    public void WhenEnabledWithoutWildcard_ReportsMissing()
    {
        var (op, missing) = SubdomainMirroringEvaluator.Evaluate(
            new SubdomainMirroringOptions
            {
                Enabled = true,
                EdgeTls = new EdgeTlsOptions
                {
                    Provider = "cloudflare",
                    Email    = "a@b.com",
                    ApiToken = "tok",
                },
            },
            new ForwardingOptions { Host = "www.olx.com.br", Domains = ["olx.com.br"] },
            "speculum.com");
        Assert.False(op);
        Assert.Contains("forwarding.domainsWildcard", missing);
    }

    [Fact]
    public void WhenEnabledAndComplete_IsOperational()
    {
        var (op, missing) = SubdomainMirroringEvaluator.Evaluate(
            new SubdomainMirroringOptions
            {
                Enabled = true,
                EdgeTls = new EdgeTlsOptions
                {
                    Provider = "cloudflare",
                    Email    = "a@b.com",
                    ApiToken = "tok",
                },
            },
            OlxWithWildcard,
            "speculum.com");
        Assert.True(op);
        Assert.Empty(missing);
    }
}

public class EdgeWriterTests : IDisposable
{
    private readonly string _tempDir;

    public EdgeWriterTests()
    {
        _tempDir = Path.Combine(Path.GetTempPath(), "speculum-edge-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_tempDir);
    }

    public void Dispose()
    {
        try { Directory.Delete(_tempDir, recursive: true); } catch { }
    }

    [Fact]
    public void Apply_WritesWildcardWhenMirroringOn()
    {
        var writer = CreateWriter(mirroring: true);
        writer.Apply();

        var envPath = Path.Combine(_tempDir, "cloudflare-speculum-com.env");
        var wildcardPath = Path.Combine(_tempDir, "dynamic", "wildcard-speculum-com.yml");
        var bootstrapPath = Path.Combine(_tempDir, "dynamic", "bootstrap.yml");
        Assert.True(File.Exists(envPath));
        Assert.True(File.Exists(wildcardPath));
        Assert.True(File.Exists(bootstrapPath));
        Assert.Contains("CF_DNS_API_TOKEN=tok", File.ReadAllText(envPath));
        Assert.Contains("speculum-web-wildcard", File.ReadAllText(wildcardPath));
        Assert.Contains("speculum-api-wildcard", File.ReadAllText(wildcardPath));
        Assert.Contains("PathPrefix(`/api`)", File.ReadAllText(wildcardPath));
        Assert.Contains("(?!www\\\\.)", File.ReadAllText(wildcardPath));
        Assert.Contains("speculum-http-wildcard", File.ReadAllText(wildcardPath));
    }

    [Fact]
    public void Apply_OmitsWildcardWhenMirroringOff()
    {
        Directory.CreateDirectory(Path.Combine(_tempDir, "dynamic"));
        File.WriteAllText(Path.Combine(_tempDir, "dynamic", "wildcard-speculum-com.yml"), "x");

        var writer = CreateWriter(mirroring: false);
        writer.Apply();

        Assert.False(File.Exists(Path.Combine(_tempDir, "cloudflare-speculum-com.env")));
        Assert.False(File.Exists(Path.Combine(_tempDir, "dynamic", "wildcard-speculum-com.yml")));
        Assert.True(File.Exists(Path.Combine(_tempDir, "dynamic", "bootstrap.yml")));
    }

    [Fact]
    public void Apply_WritesHttpRedirectWhenProfilesExist()
    {
        var writer = CreateWriter(mirroring: false);
        writer.Apply();

        var motor = File.ReadAllText(Path.Combine(_tempDir, "dynamic", "motor.yml"));
        Assert.Contains("speculum-http-redirect", motor);
        Assert.Contains("redirectScheme", motor);
        Assert.Contains("!PathPrefix(`/.well-known/acme-challenge/`)", motor);
    }

    private EdgeWriter CreateWriter(bool mirroring)
    {
        var dbPath = Path.Combine(_tempDir, "speculum.db");
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["HttpAddress"]     = "127.0.0.1:8080",
            ["Database:Path"]   = dbPath,
            ["Sidecar:BaseUrl"] = "ws://127.0.0.1:3000",
            ["Traefik:Root"]    = _tempDir,
        }).Build();

        var bootstrap = BootstrapConfig.Load(config);
        var services = new ServiceCollection()
            .AddSingleton<ISpeculumConfigStore>(new StubEdgeConfigStore(mirroring))
            .BuildServiceProvider();

        return new EdgeWriter(
            services,
            bootstrap,
            new TraefikReloader(config, NullLogger<TraefikReloader>.Instance),
            config,
            NullLogger<EdgeWriter>.Instance);
    }

    private sealed class StubEdgeConfigStore : ISpeculumConfigStore
    {
        public StubEdgeConfigStore(bool mirroring)
        {
            Current = new SpeculumRuntimeConfig
            {
                Hosting = new HostingOptions
                {
                    AcmeEmail = "admin@example.com",
                    Profiles =
                    [
                        new HostingProfileOptions
                        {
                            Domain = "speculum.com",
                            SubdomainMirroringEnabled = mirroring,
                            EdgeTls = mirroring
                                ? new EdgeTlsOptions
                                {
                                    Provider = "cloudflare",
                                    Email    = "a@b.com",
                                    ApiToken = "tok",
                                }
                                : null,
                        },
                    ],
                },
                Forwarding = new ForwardingOptions
                {
                    Host    = "www.olx.com.br",
                    Domains = ["olx.com.br", "*.olx.com.br"],
                },
            };
        }

        public SpeculumRuntimeConfig Current { get; }
        public bool IsOperational => true;
        public IReadOnlyList<string> MissingRequired => [];
        public bool SubdomainMirroringEnabled => Current.Hosting.Profiles.Any(p => p.SubdomainMirroringEnabled);
        public bool IsSubdomainMirroringOperational => SubdomainMirroringEnabled;
        public IReadOnlyList<string> MissingSubdomainMirroring => [];

        public Task InitializeAsync(CancellationToken ct = default) => Task.CompletedTask;
        public Task<ConfigUpdateResult> PutSectionAsync(string key, JsonElement body, CancellationToken ct = default)
            => throw new NotSupportedException();
        public Task<JsonElement?> GetSectionAsync(string key, CancellationToken ct = default)
            => throw new NotSupportedException();
        public Task<ConfigUpdateResult> DeleteSectionAsync(string key, CancellationToken ct = default)
            => throw new NotSupportedException();
    }
}
