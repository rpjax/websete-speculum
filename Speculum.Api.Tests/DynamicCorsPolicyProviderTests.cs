using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Speculum.Api.Config.Bootstrap;
using Speculum.Api.Config.Runtime;
using Speculum.Api.Config.Store;
using Speculum.Api.Edge.Cors;

namespace Speculum.Api.Tests;

public class DynamicCorsPolicyProviderTests
{
    [Fact]
    public async Task DevBootstrapOrigin_IsAllowed()
    {
        var provider = new DynamicCorsPolicyProvider(Bootstrap(isDev: true));
        var context = HttpContextWithStore([]);

        var policy = await provider.GetPolicyAsync(context, null);
        Assert.NotNull(policy);
        Assert.True(policy!.IsOriginAllowed("http://localhost:5173"));
    }

    [Fact]
    public async Task KnownHostingProfile_AllowsApexOrigin()
    {
        var provider = new DynamicCorsPolicyProvider(Bootstrap(isDev: false));
        var context = HttpContextWithStore(
        [
            new HostingProfileOptions { Domain = "speculum.com", SubdomainMirroringEnabled = true },
        ],
        [
            new HostingProfileStatus { Domain = "speculum.com", MirroringOperational = false },
        ]);

        var policy = await provider.GetPolicyAsync(context, null);
        Assert.NotNull(policy);
        Assert.True(policy!.IsOriginAllowed("https://www.speculum.com"));
        Assert.True(policy.IsOriginAllowed("https://speculum.com"));
        Assert.False(policy.IsOriginAllowed("https://evil.com"));
    }

    [Fact]
    public async Task MirroredSubdomainOrigin_RequiresOperationalStatus()
    {
        var provider = new DynamicCorsPolicyProvider(Bootstrap(isDev: false));
        var pending = HttpContextWithStore(
        [
            new HostingProfileOptions { Domain = "speculum.com", SubdomainMirroringEnabled = true },
        ],
        [
            new HostingProfileStatus { Domain = "speculum.com", MirroringOperational = false },
        ]);
        var ready = HttpContextWithStore(
        [
            new HostingProfileOptions { Domain = "speculum.com", SubdomainMirroringEnabled = true },
        ],
        [
            new HostingProfileStatus { Domain = "speculum.com", MirroringOperational = true },
        ]);

        var pendingPolicy = await provider.GetPolicyAsync(pending, null);
        var readyPolicy = await provider.GetPolicyAsync(ready, null);

        Assert.NotNull(pendingPolicy);
        Assert.NotNull(readyPolicy);
        Assert.False(pendingPolicy!.IsOriginAllowed("https://cars.speculum.com"));
        Assert.True(readyPolicy!.IsOriginAllowed("https://cars.speculum.com"));
    }

    private static BootstrapConfig Bootstrap(bool isDev)
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["HttpAddress"]           = "127.0.0.1:8080",
            ["Database:Path"]         = "/tmp/speculum.db",
            ["Sidecar:BaseUrl"]       = "ws://127.0.0.1:3000",
            ["ASPNETCORE_ENVIRONMENT"] = isDev ? "Development" : "Production",
            ["Cors:AllowedOrigins"]   = "http://localhost:5173",
        }).Build();

        return BootstrapConfig.Load(config);
    }

    private static DefaultHttpContext HttpContextWithStore(
        IReadOnlyList<HostingProfileOptions> profiles,
        IReadOnlyList<HostingProfileStatus>? statuses = null)
    {
        var services = new ServiceCollection()
            .AddSingleton<ISpeculumConfigStore>(new StubCorsConfigStore(profiles, statuses))
            .BuildServiceProvider();

        return new DefaultHttpContext { RequestServices = services };
    }

    private sealed class StubCorsConfigStore : ISpeculumConfigStore
    {
        public StubCorsConfigStore(
            IReadOnlyList<HostingProfileOptions> profiles,
            IReadOnlyList<HostingProfileStatus>? statuses = null)
        {
            Current = new SpeculumRuntimeConfig
            {
                Hosting = new HostingOptions { Profiles = profiles },
                HostingProfileStatuses = statuses ?? [],
            };
        }

        public SpeculumRuntimeConfig Current { get; }
        public bool IsOperational => true;
        public IReadOnlyList<string> MissingRequired => [];

        public Task InitializeAsync(CancellationToken ct = default) => Task.CompletedTask;
        public Task<ConfigUpdateResult> PutSectionAsync(string key, JsonElement body, CancellationToken ct = default)
            => throw new NotSupportedException();
        public Task<JsonElement?> GetSectionAsync(string key, CancellationToken ct = default)
            => throw new NotSupportedException();
        public Task<ConfigUpdateResult> DeleteSectionAsync(string key, CancellationToken ct = default)
            => throw new NotSupportedException();
    }
}
