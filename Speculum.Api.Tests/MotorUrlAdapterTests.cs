using Speculum.Api.BrowserPersistence;
using Speculum.Api.Config.Runtime;
using Speculum.Api.Motor.Mapping;
using Speculum.Api.Motor.Live;

namespace Speculum.Api.Tests;

public class MotorUrlAdapterTests
{
    private static MotorUrlAdapter DevAdapter()
        => new(new NavigationStateCodec(new byte[32], encrypt: false));

    private static MotorUrlAdapter ProdAdapter()
        => new(new NavigationStateCodec(new byte[32], encrypt: true));

    private static ForwardingOptions OlxForwarding => new()
    {
        Host    = "www.olx.com.br",
        Domains = ["olx.com.br", "*.olx.com.br"],
    };

    private static HostingProfileOptions ApexProfile => new()
    {
        Domain = "speculum.com",
        SubdomainMirroringEnabled = false,
    };

    private static HostingProfileOptions MirroringProfile => new()
    {
        Domain = "speculum.com",
        SubdomainMirroringEnabled = true,
    };

    [Fact]
    public void ParseClientToTarget_ApexMode_UsesNsoHostLabel()
    {
        var adapter = DevAdapter();
        var codec = new NavigationStateCodec(new byte[32], encrypt: false);
        var encoded = codec.Encode(new NavigationStateV1 { H = "cars" });
        var clientUrl = $"https://speculum.com/list?{W7sNavigationQueryParam.Name}={encoded}";

        var target = adapter.ParseClientToTarget(clientUrl, ApexProfile, OlxForwarding);
        Assert.Equal("https://cars.olx.com.br/list", target);
        Assert.DoesNotContain(W7sNavigationQueryParam.Name, target);
    }

    [Fact]
    public void ParseClientToTarget_RejectsNonHttpSchemes()
    {
        var adapter = DevAdapter();
        var ex = Assert.Throws<ArgumentException>(() =>
            adapter.ParseClientToTarget("ftp://speculum.com/", ApexProfile, OlxForwarding));
        Assert.Contains("http or https", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void EncodeTargetToClient_ApexMode_AddsEncryptedNsoInDevIsBase64()
    {
        var adapter = DevAdapter();
        var client = adapter.EncodeTargetToClient(
            "https://cars.olx.com.br/list?q=1",
            ApexProfile,
            OlxForwarding,
            "speculum.com");

        Assert.StartsWith("https://speculum.com/list", client, StringComparison.Ordinal);
        Assert.Contains($"{W7sNavigationQueryParam.Name}=", client);
        Assert.DoesNotContain("cars.olx.com.br", client);
    }

    [Fact]
    public void RoundTrip_ApexMode_PreservesPathAndQuery()
    {
        var adapter = DevAdapter();
        var originalTarget = "https://www.olx.com.br/search?q=test";
        var client = adapter.EncodeTargetToClient(originalTarget, ApexProfile, OlxForwarding, "speculum.com");
        var back = adapter.ParseClientToTarget(client, ApexProfile, OlxForwarding);
        Assert.Equal(originalTarget, back);
    }

    [Fact]
    public void MirroringOn_DelegatesToHostMapper()
    {
        var adapter = DevAdapter();
        var client = "https://cars.speculum.com/path";
        var target = adapter.ParseClientToTarget(client, MirroringProfile, OlxForwarding);
        Assert.Equal("https://cars.olx.com.br/path", target);
    }

    [Fact]
    public void ProdCodec_EncryptsNsoPayload()
    {
        var codec = new NavigationStateCodec(new byte[32], encrypt: true);
        var encoded = codec.Encode(new NavigationStateV1 { H = "www" });
        var decoded = codec.Decode(encoded);
        Assert.NotNull(decoded);
        Assert.Equal("www", decoded!.H);
    }
}

public class HostingProfileResolverTests
{
    [Theory]
    [InlineData("speculum.com", "speculum.com")]
    [InlineData("www.speculum.com", "speculum.com")]
    [InlineData("cars.speculum.com", "speculum.com")]
    public void Resolve_MatchesExpectedProfile(string host, string expectedDomain)
    {
        var hosting = new HostingOptions
        {
            Profiles =
            [
                new HostingProfileOptions { Domain = "speculum.com", SubdomainMirroringEnabled = true },
            ],
        };

        var profile = HostingProfileResolver.Resolve(host, hosting);
        Assert.NotNull(profile);
        Assert.Equal(expectedDomain, profile!.Domain);
    }

    [Fact]
    public void Resolve_UnknownHost_ReturnsNull()
    {
        var hosting = new HostingOptions
        {
            Profiles = [new HostingProfileOptions { Domain = "speculum.com" }],
        };
        Assert.Null(HostingProfileResolver.Resolve("10.0.0.1", hosting));
    }

    private static readonly HostingOptions MirroringHosting = new()
    {
        Profiles =
        [
            new HostingProfileOptions
            {
                Domain = "speculum.com",
                SubdomainMirroringEnabled = true,
            },
        ],
    };

    [Fact]
    public void IsAllowedOriginHost_Apex_AlwaysAllowed()
    {
        Assert.True(HostingProfileResolver.IsAllowedOriginHost("speculum.com", MirroringHosting, []));
        Assert.True(HostingProfileResolver.IsAllowedOriginHost("www.speculum.com", MirroringHosting, []));
    }

    [Fact]
    public void IsAllowedOriginHost_MirroredSubdomain_OnlyWhenOperational()
    {
        var pending = new[] { new HostingProfileStatus { Domain = "speculum.com", MirroringOperational = false } };
        var ready = new[] { new HostingProfileStatus { Domain = "speculum.com", MirroringOperational = true } };

        Assert.False(HostingProfileResolver.IsAllowedOriginHost("cars.speculum.com", MirroringHosting, pending));
        Assert.True(HostingProfileResolver.IsAllowedOriginHost("cars.speculum.com", MirroringHosting, ready));
    }
}

public class SessionIdentityStoreTests
{
    [Fact]
    public async Task ResolveOrCreateSessionAsync_LookupByIndexer()
    {
        var dir = Path.Combine(Path.GetTempPath(), "speculum-id-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        var db = Path.Combine(dir, "speculum.db");
        try
        {
            var store = new BrowserSessionStore(
                db, Microsoft.Extensions.Logging.Abstractions.NullLogger<BrowserSessionStore>.Instance);
            await store.InitializeAsync();

            var token = "abcdef0123456789abcdef0123456789";
            var id1 = await store.ResolveOrCreateSessionAsync(
                new SessionIdentity
                {
                    ClientToken = token,
                    Indexers = new Dictionary<string, string> { ["tenant"] = "acme" },
                });
            var id2 = await store.ResolveOrCreateSessionAsync(
                new SessionIdentity
                {
                    Indexers = new Dictionary<string, string> { ["tenant"] = "acme" },
                });

            Assert.Equal(id1.SessionId, id2.SessionId);
            Assert.Equal(token, id1.ClientToken);
            Assert.False(id1.Restored);
            Assert.True(id2.Restored);

            var id3 = await store.ResolveOrCreateSessionAsync(
                new SessionIdentity
                {
                    Indexers = new Dictionary<string, string> { ["client_token"] = token },
                });
            Assert.Equal(id1.SessionId, id3.SessionId);
        }
        finally
        {
            try { Directory.Delete(dir, recursive: true); } catch { }
        }
    }
}
