using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Speculum.Api.Config.Runtime;
using Speculum.Api.Config.Store;
using Speculum.Api.Diagnostics.Pipeline;
using Speculum.Api.Motor.Live;
using Speculum.Api.Motor.Mapping;
using Speculum.Api.Motor.Sidecar;
using Speculum.Api.BrowserPersistence;

namespace Speculum.Api.Tests;

public class BrowserSessionStoreTests : IDisposable
{
    private readonly string _tempDir;
    private readonly string _dbPath;

    public BrowserSessionStoreTests()
    {
        _tempDir = Path.Combine(Path.GetTempPath(), "speculum-sess-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_tempDir);
        _dbPath = Path.Combine(_tempDir, "speculum.db");
    }

    public void Dispose()
    {
        try { Directory.Delete(_tempDir, recursive: true); } catch { }
    }

    [Fact]
    public async Task ResolveOrCreateSessionAsync_CreatesAndReuses()
    {
        var store = new BrowserSessionStore(_dbPath, NullLogger<BrowserSessionStore>.Instance);
        await store.InitializeAsync();

        const string token = "abcdef0123456789abcdef0123456789";
        var id1 = await store.ResolveOrCreateSessionAsync(token);
        var id2 = await store.ResolveOrCreateSessionAsync(token);
        Assert.Equal(id1, id2);
    }

    [Fact]
    public async Task SaveAndLoadState_RoundTrips()
    {
        var store = new BrowserSessionStore(_dbPath, NullLogger<BrowserSessionStore>.Instance);
        await store.InitializeAsync();

        const string token = "abcdef0123456789abcdef0123456789";
        var sessionId = await store.ResolveOrCreateSessionAsync(token);

        var state = new BrowserStatePayload
        {
            Cookies =
            [
                new BrowserCookieState
                {
                    Name = "sid", Value = "1", Domain = ".example.com", Path = "/",
                },
            ],
        };

        await store.SaveStateAsync(sessionId, state);
        var loaded = await store.LoadStateAsync(sessionId);
        Assert.NotNull(loaded);
        Assert.Single(loaded!.Cookies);
        Assert.Equal("sid", loaded.Cookies[0].Name);
    }

    [Fact]
    public async Task PurgeExpired_RemovesOldSessions()
    {
        var store = new BrowserSessionStore(_dbPath, NullLogger<BrowserSessionStore>.Instance);
        await store.InitializeAsync();

        var sessionId = await store.ResolveOrCreateSessionAsync("abcdef0123456789abcdef0123456789");
        await store.SaveStateAsync(sessionId, new BrowserStatePayload());

        await using var db = new Speculum.Api.Config.Persistence.SpeculumDbContext(_dbPath);
        await db.Database.ExecuteSqlRawAsync(
            "UPDATE browser_sessions SET expires_at = {0} WHERE session_id = {1}",
            [DateTimeOffset.UtcNow.AddDays(-1).ToString("O"), sessionId]);

        await store.PurgeExpiredAsync();
        Assert.Null(await store.LoadStateAsync(sessionId));
    }
}

public class ClientTokenNormalizerTests
{
    [Fact]
    public void Resolve_generates_token_when_null()
    {
        var id = ClientTokenNormalizer.Resolve(null);
        Assert.Matches("^[a-f0-9]{32}$", id);
    }

    [Fact]
    public void Resolve_accepts_valid_hex_token()
    {
        const string existing = "abcdef0123456789abcdef0123456789";
        Assert.Equal(existing, ClientTokenNormalizer.Resolve(existing));
    }

    [Fact]
    public void Resolve_rejects_invalid_token()
    {
        Assert.Throws<ArgumentException>(() => ClientTokenNormalizer.Resolve("not-valid"));
    }
}

public class HostMapperTests
{
    private static ForwardingOptions OlxForwarding => new()
    {
        Host    = "www.olx.com.br",
        Domains = ["olx.com.br", "*.olx.com.br"],
    };

    [Fact]
    public void MapClientToTarget_apex_maps_to_forwarding_host()
    {
        var url = HostMapper.MapClientToTarget(
            "https://speculum.com/cars",
            "speculum.com",
            OlxForwarding);
        Assert.Equal("https://www.olx.com.br/cars", url);
    }

    [Fact]
    public void MapTargetToClient_subdomain_when_enabled()
    {
        var url = HostMapper.MapTargetToClient(
            "https://www.olx.com.br/cars",
            "speculum.com",
            OlxForwarding);
        Assert.Equal("https://www.speculum.com/cars", url);
    }

    [Fact]
    public void MapTargetToApexClient_strips_subdomain()
    {
        var url = HostMapper.MapTargetToApexClient(
            "https://www.olx.com.br/cars",
            "speculum.com");
        Assert.Equal("https://speculum.com/cars", url);
    }
}

public class ConfigValidatorScriptTests
{
    [Fact]
    public void ScriptInjection_RejectsPrivateUrl()
    {
        var body = System.Text.Json.JsonDocument.Parse("""
            [{ "url": "http://127.0.0.1/evil.js", "position": "HeaderTop", "type": "Classic" }]
            """).RootElement;

        var ex = Assert.Throws<ConfigValidationException>(() =>
            ConfigValidator.ValidateSection(ConfigSectionKeys.ScriptInjection, body));

        Assert.Contains(ex.Errors, e => e.Message.Contains("SSRF"));
    }

    [Fact]
    public void ScriptInjection_RejectsInvalidScriptId()
    {
        var body = System.Text.Json.JsonDocument.Parse("""
            [{ "scriptId": "not-hex", "position": "HeaderTop", "type": "Classic" }]
            """).RootElement;

        var ex = Assert.Throws<ConfigValidationException>(() =>
            ConfigValidator.ValidateSection(ConfigSectionKeys.ScriptInjection, body));

        Assert.Contains(ex.Errors, e => e.Path.Contains("scriptId"));
    }

    [Fact]
    public void Hosting_WhenMirroringOnWithWildcard_Passes()
    {
        var body = System.Text.Json.JsonDocument.Parse("""
            {
              "acmeEmail": "admin@example.com",
              "profiles": [{
                "domain": "speculum.com",
                "subdomainMirroringEnabled": true,
                "edgeTls": { "provider": "cloudflare", "email": "a@b.com", "apiToken": "tok" }
              }]
            }
            """).RootElement;

        ConfigValidator.ValidateSection(
            ConfigSectionKeys.Hosting,
            body,
            new ForwardingOptions { Host = "www.olx.com.br", Domains = ["olx.com.br", "*.olx.com.br"] });
    }

    [Fact]
    public void Hosting_WhenMirroringOn_RequiresWildcard()
    {
        var body = System.Text.Json.JsonDocument.Parse("""
            {
              "acmeEmail": "admin@example.com",
              "profiles": [{
                "domain": "speculum.com",
                "subdomainMirroringEnabled": true,
                "edgeTls": { "provider": "cloudflare", "email": "a@b.com", "apiToken": "tok" }
              }]
            }
            """).RootElement;

        var ex = Assert.Throws<ConfigValidationException>(() =>
            ConfigValidator.ValidateSection(
                ConfigSectionKeys.Hosting,
                body,
                new ForwardingOptions { Host = "www.olx.com.br", Domains = ["olx.com.br"] }));

        Assert.Contains(ex.Errors, e => e.Message.Contains("wildcard", StringComparison.OrdinalIgnoreCase));
    }
}

public class MotorSessionRegistryTests
{
    private static MotorUrlAdapter TestAdapter()
        => new(new NavigationStateCodec(new byte[32], encrypt: false));

    [Fact]
    public void TryAcquireSlot_IsAtomic()
    {
        var registry = new MotorSessionRegistry();
        Assert.True(registry.TryAcquireSlot(2));
        Assert.True(registry.TryAcquireSlot(2));
        Assert.False(registry.TryAcquireSlot(2));
        registry.ReleaseSlot();
        Assert.True(registry.TryAcquireSlot(2));
    }

    [Fact]
    public void TryPromoteStarting_FailsAfterCancel()
    {
        var registry = new MotorSessionRegistry();
        var session  = new MotorSession(
            new SidecarBrowserClientOptions { SidecarBaseUrl = "ws://localhost" },
            new SessionConfigSnapshot { InitialUrl = "https://example.com" },
            TestAdapter(),
            new SidecarClientFactory(),
            TestMotorDiagnostics.Emitter(new NullDiagnosticsEventBus()),
            NullLogger<MotorSession>.Instance);

        registry.TrackStarting("conn-1", session);
        Assert.True(registry.TryCancelStarting("conn-1", out _));
        Assert.False(registry.TryPromoteStarting("conn-1", session));
    }

    [Fact]
    public async Task StopAllAsync_releases_slot_for_starting_session()
    {
        var registry = new MotorSessionRegistry();
        var session  = new MotorSession(
            new SidecarBrowserClientOptions { SidecarBaseUrl = "ws://localhost" },
            new SessionConfigSnapshot { InitialUrl = "https://example.com" },
            TestAdapter(),
            new SidecarClientFactory(),
            TestMotorDiagnostics.Emitter(new NullDiagnosticsEventBus()),
            NullLogger<MotorSession>.Instance);

        Assert.True(registry.TryAcquireSlot(10));
        registry.TrackStarting("conn-1", session);
        Assert.Equal(1, registry.ActiveCount);

        await registry.StopAllAsync(new NoOpSessionStore());

        Assert.Equal(0, registry.ActiveCount);
    }

    private sealed class NoOpSessionStore : IBrowserSessionStore
    {
        public Task InitializeAsync(CancellationToken ct = default) => Task.CompletedTask;
        public Task<string> ResolveOrCreateSessionAsync(string clientToken, CancellationToken ct = default)
            => Task.FromResult(Guid.NewGuid().ToString("N"));
        public Task<SessionResolveResult> ResolveOrCreateSessionAsync(
            SessionIdentity identity, CancellationToken ct = default)
            => Task.FromResult(new SessionResolveResult(
                Guid.NewGuid().ToString("N"),
                identity.ClientToken ?? Guid.NewGuid().ToString("N"),
                Restored: false));
        public Task<BrowserStatePayload?> LoadStateAsync(string sessionId, CancellationToken ct = default)
            => Task.FromResult<BrowserStatePayload?>(null);
        public Task SaveStateAsync(string sessionId, BrowserStatePayload state, CancellationToken ct = default)
            => Task.CompletedTask;
        public Task<IReadOnlyList<BrowserSessionMetadata>> ListSessionsAsync(CancellationToken ct = default)
            => Task.FromResult<IReadOnlyList<BrowserSessionMetadata>>([]);
        public Task<BrowserSessionDetail?> GetSessionDetailAsync(string sessionId, CancellationToken ct = default)
            => Task.FromResult<BrowserSessionDetail?>(null);
        public Task<bool> DeleteSessionAsync(string sessionId, CancellationToken ct = default)
            => Task.FromResult(false);
        public Task RefreshPolicyAsync(CancellationToken ct = default) => Task.CompletedTask;
        public Task PurgeExpiredAsync(CancellationToken ct = default) => Task.CompletedTask;
    }
}
