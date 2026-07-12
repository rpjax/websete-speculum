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
    [Fact]
    public void Build_ApexMode_PreservesPathAndQuery()
    {
        var forwarding = new ForwardingOptions { Host = "www.olx.com.br", Domains = ["*.olx.com.br"] };
        var url = InitialUrlBuilder.Build(forwarding, "https://proxy.local/cars?q=1", false, "speculum.com");
        Assert.Equal("https://www.olx.com.br/cars?q=1", url);
    }

    [Fact]
    public void Build_SubdomainMode_MapsHost()
    {
        var forwarding = new ForwardingOptions { Host = "www.olx.com.br", Domains = ["olx.com.br", "*.olx.com.br"] };
        var url = InitialUrlBuilder.Build(forwarding, "https://www.speculum.com/cars", true, "speculum.com");
        Assert.Equal("https://www.olx.com.br/cars", url);
    }

    [Fact]
    public void Build_RejectsInvalidClientUrl()
    {
        var forwarding = new ForwardingOptions { Host = "www.olx.com.br", Domains = ["*.olx.com.br"] };
        Assert.Throws<ArgumentException>(() =>
            InitialUrlBuilder.Build(forwarding, "not-a-url", false, "speculum.com"));
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

public class EdgeTlsWriterTests : IDisposable
{
    private readonly string _tempDir;

    public EdgeTlsWriterTests()
    {
        _tempDir = Path.Combine(Path.GetTempPath(), "speculum-edgetls-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_tempDir);
    }

    public void Dispose()
    {
        try { Directory.Delete(_tempDir, recursive: true); } catch { }
    }

    [Fact]
    public void Apply_WritesFilesWhenOperational()
    {
        var dynamicDir = Path.Combine(_tempDir, "dynamic");
        var writer = CreateWriter(dynamicDir, operational: true);
        writer.Apply();

        var envPath      = Path.Combine(_tempDir, "cloudflare.env");
        var wildcardPath = Path.Combine(dynamicDir, "subdomain-wildcard.yml");
        Assert.True(File.Exists(envPath));
        Assert.True(File.Exists(wildcardPath));
        Assert.Contains("CF_DNS_API_TOKEN=tok", File.ReadAllText(envPath));
        Assert.Contains("speculum-web-wildcard", File.ReadAllText(wildcardPath));
        Assert.Contains("speculum-web@docker", File.ReadAllText(wildcardPath));
    }

    [Fact]
    public void Apply_RemovesFilesWhenInactive()
    {
        var dynamicDir = Path.Combine(_tempDir, "dynamic");
        Directory.CreateDirectory(dynamicDir);
        File.WriteAllText(Path.Combine(_tempDir, "cloudflare.env"), "x");
        File.WriteAllText(Path.Combine(dynamicDir, "subdomain-wildcard.yml"), "x");

        var writer = CreateWriter(dynamicDir, operational: false);
        writer.Apply();

        Assert.False(File.Exists(Path.Combine(_tempDir, "cloudflare.env")));
        Assert.False(File.Exists(Path.Combine(dynamicDir, "subdomain-wildcard.yml")));
    }

    private EdgeTlsWriter CreateWriter(string dynamicDir, bool operational)
    {
        var dbPath = Path.Combine(_tempDir, "speculum.db");
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["HttpAddress"]        = "127.0.0.1:8080",
            ["Database:Path"]      = dbPath,
            ["Sidecar:BaseUrl"]    = "ws://127.0.0.1:3000",
            ["Motor:PublicDomain"] = "speculum.com",
            ["Traefik:DynamicDir"] = dynamicDir,
        }).Build();

        var bootstrap = BootstrapConfig.Load(config);
        var services = new ServiceCollection()
            .AddSingleton<ISpeculumConfigStore>(new StubConfigStore(operational))
            .BuildServiceProvider();

        return new EdgeTlsWriter(
            services,
            bootstrap,
            config,
            NullLogger<EdgeTlsWriter>.Instance);
    }

    private sealed class StubConfigStore : ISpeculumConfigStore
    {
        private readonly bool _operational;

        public StubConfigStore(bool operational)
        {
            _operational = operational;
            Current = new SpeculumRuntimeConfig
            {
                SubdomainMirroring = new SubdomainMirroringOptions
                {
                    Enabled = operational,
                    EdgeTls = new EdgeTlsOptions
                    {
                        Provider = "cloudflare",
                        Email    = "a@b.com",
                        ApiToken = "tok",
                    },
                },
            };
        }

        public SpeculumRuntimeConfig Current { get; }
        public bool IsOperational => true;
        public IReadOnlyList<string> MissingRequired => [];
        public bool SubdomainMirroringEnabled => _operational;
        public bool IsSubdomainMirroringOperational => _operational;
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
