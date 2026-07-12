using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Speculum.Api.Config.Bootstrap;
using Speculum.Api.Config.Runtime;
using Speculum.Api.Config.Store;
using Speculum.Api.Hosting;

namespace Speculum.Api.Tests;

public class DynamicCorsPolicyProviderTests
{
    [Fact]
    public async Task SubdomainOff_UsesBootstrapOrigins()
    {
        var provider = new DynamicCorsPolicyProvider(Bootstrap("speculum.com", ["https://speculum.com"]));
        var context = HttpContextWithStore(subdomainOperational: false);

        var policy = await provider.GetPolicyAsync(context, null);
        Assert.NotNull(policy);
        Assert.True(policy!.IsOriginAllowed("https://speculum.com"));
        Assert.False(policy.IsOriginAllowed("https://www.speculum.com"));
    }

    [Fact]
    public async Task SubdomainOn_AllowsMotorSubdomainsAndBootstrapOrigins()
    {
        var provider = new DynamicCorsPolicyProvider(Bootstrap(
            "speculum.com",
            ["http://localhost:5173", "https://speculum.com"]));
        var context = HttpContextWithStore(subdomainOperational: true);

        var policy = await provider.GetPolicyAsync(context, null);
        Assert.NotNull(policy);
        Assert.True(policy!.IsOriginAllowed("https://www.speculum.com"));
        Assert.True(policy.IsOriginAllowed("http://localhost:5173"));
        Assert.False(policy.IsOriginAllowed("https://evil.com"));
    }

    private static BootstrapConfig Bootstrap(string motorDomain, string[] corsOrigins)
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["HttpAddress"]         = "127.0.0.1:8080",
            ["Database:Path"]       = "/tmp/speculum.db",
            ["Sidecar:BaseUrl"]     = "ws://127.0.0.1:3000",
            ["Motor:PublicDomain"]  = motorDomain,
            ["Cors:AllowedOrigins"] = string.Join(';', corsOrigins),
        }).Build();

        return BootstrapConfig.Load(config);
    }

    private static DefaultHttpContext HttpContextWithStore(bool subdomainOperational)
    {
        var services = new ServiceCollection()
            .AddSingleton<ISpeculumConfigStore>(new StubCorsConfigStore(subdomainOperational))
            .BuildServiceProvider();

        return new DefaultHttpContext { RequestServices = services };
    }

    private sealed class StubCorsConfigStore : ISpeculumConfigStore
    {
        public StubCorsConfigStore(bool subdomainOperational) =>
            IsSubdomainMirroringOperational = subdomainOperational;

        public SpeculumRuntimeConfig Current { get; } = new();
        public bool IsOperational => true;
        public IReadOnlyList<string> MissingRequired => [];
        public bool SubdomainMirroringEnabled => IsSubdomainMirroringOperational;
        public bool IsSubdomainMirroringOperational { get; }
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
