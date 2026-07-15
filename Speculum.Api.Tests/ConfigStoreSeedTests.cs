using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Logging.Abstractions;
using Speculum.Api.Config.Bootstrap;
using Speculum.Api.Config.Runtime;
using Speculum.Api.Config.Application;
using Speculum.Api.Config.Persistence;
using Speculum.Api.Config.Store;
using Speculum.Api.Diagnostics.Abstractions;
using Speculum.Api.Edge;
using Speculum.Api.Scripts;
using Speculum.Api.Motor.Live;
using Speculum.Api.BrowserPersistence;

namespace Speculum.Api.Tests;

public class ConfigStoreSeedTests : IDisposable
{
    private readonly string _dbPath;
    private readonly string _tempDir;

    public ConfigStoreSeedTests()
    {
        _tempDir = Path.Combine(Path.GetTempPath(), "speculum-test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_tempDir);
        _dbPath = Path.Combine(_tempDir, "speculum.db");
    }

    public void Dispose()
    {
        Environment.SetEnvironmentVariable("SPECULUM_DIAGNOSTICS_PROFILE", null);
        try { Directory.Delete(_tempDir, recursive: true); }
        catch { /* best-effort */ }
    }

    [Fact]
    public async Task Seed_WritesBootstrapAdminOnly_WhenDbEmpty()
    {
        Environment.SetEnvironmentVariable(ConfigService.BootstrapKeyEnvVar, "test-bootstrap-key");

        var store = CreateStore();
        await store.InitializeAsync();

        Assert.False(store.IsOperational);
        Assert.Equal("test-bootstrap-key", store.Current.AdminApiKey);
        Assert.Null(store.Current.Forwarding);
        Assert.Null(store.Current.MaxSessions);
        Assert.True(store.Current.Diagnostics.Enabled);

        Environment.SetEnvironmentVariable(ConfigService.BootstrapKeyEnvVar, null);
    }

    [Fact]
    public async Task Seed_DoesNotOverwriteExistingSections()
    {
        var store = CreateStore();
        await store.InitializeAsync();

        await store.PutSectionAsync(ConfigSectionKeys.Forwarding,
            JsonDocument.Parse("""
            { "host": "www.example.com", "domains": ["example.com", "*.example.com"] }
            """).RootElement);
        await store.PutSectionAsync(ConfigSectionKeys.MaxSessions,
            JsonDocument.Parse("5").RootElement);
        await store.PutSectionAsync(ConfigSectionKeys.Hosting,
            JsonDocument.Parse("""
            { "profiles": [{ "domain": "example.test", "subdomainMirroringEnabled": false }] }
            """).RootElement);
        await store.PutSectionAsync(ConfigSectionKeys.Admin,
            JsonDocument.Parse("""{ "apiKey": "custom-key" }""").RootElement);

        Assert.True(store.IsOperational);
        Assert.Equal("www.example.com", store.Current.Forwarding!.Host);
        Assert.Equal(5, store.Current.MaxSessions);
        Assert.Equal("custom-key", store.Current.AdminApiKey);

        var store2 = CreateStore();
        await store2.InitializeAsync();

        Assert.True(store2.IsOperational);
        Assert.Equal("www.example.com", store2.Current.Forwarding!.Host);
        Assert.Equal(5, store2.Current.MaxSessions);
        Assert.Equal("custom-key", store2.Current.AdminApiKey);
    }

    [Fact]
    public async Task Delete_Diagnostics_reseeds_development_defaults()
    {
        var store = CreateStore();
        await store.InitializeAsync();

        await store.PutSectionAsync(ConfigSectionKeys.Diagnostics,
            JsonDocument.Parse("""
            {
              "enabled": true,
              "profile": "Production",
              "domains": {
                "motor": { "metrics": true, "events": false, "snapshots": false },
                "sidecar": { "metrics": true, "events": false },
                "browserQuery": { "probe": false },
                "persisted": { "snapshots": false }
              }
            }
            """).RootElement);

        Assert.False(store.Current.Diagnostics.Domains.BrowserQuery.Probe);

        var result = await store.DeleteSectionAsync(ConfigSectionKeys.Diagnostics);
        Assert.True(result.Success);
        Assert.True(store.Current.Diagnostics.Domains.BrowserQuery.Probe);
        Assert.True(store.Current.Diagnostics.Domains.Motor.Events);
    }

    [Fact]
    public async Task Seed_uses_Assertive_profile_when_env_set()
    {
        Environment.SetEnvironmentVariable("SPECULUM_DIAGNOSTICS_PROFILE", "Assertive");
        try
        {
            var store = CreateStore();
            await store.InitializeAsync();
            Assert.True(store.Current.Diagnostics.Domains.BrowserQuery.Probe);
            Assert.True(store.Current.Diagnostics.Domains.Motor.Snapshots);
            Assert.Equal("Assertive", store.Current.Diagnostics.Profile);
        }
        finally
        {
            Environment.SetEnvironmentVariable("SPECULUM_DIAGNOSTICS_PROFILE", null);
        }
    }

    private ConfigService CreateStore()
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["HttpAddress"] = "127.0.0.1:8080",
                ["Database:Path"] = _dbPath,
                ["Sidecar:BaseUrl"] = "ws://127.0.0.1:3000",
                ["ASPNETCORE_ENVIRONMENT"] = "Development",
            })
            .Build();
        var bootstrap = BootstrapConfig.Load(config);
        var env = new FakeWebHostEnvironment { WebRootPath = _tempDir };
        var registry = new MotorSessionRegistry();
        var scriptStore = new InjectedScriptStore(_dbPath);
        var sessionStore = new BrowserSessionStore(_dbPath, NullLogger<BrowserSessionStore>.Instance);
        var resolver = new ScriptResolver(
            new HttpClientFactoryStub(),
            scriptStore,
            NullLogger<ScriptResolver>.Instance);

        var repository = new ConfigSectionRepository(_dbPath);
        var loader = new ConfigLoader(resolver, NullLogger<ConfigLoader>.Instance);
        var secrets = new MotorSecretsStore(_dbPath);

        ConfigService? store = null;
        var lazyStore = new Lazy<ISpeculumConfigStore>(() => store!);
        var edgeSynchronizer = new EdgeSynchronizer(
            lazyStore,
            bootstrap,
            new TraefikReloader(config, NullLogger<TraefikReloader>.Instance),
            config,
            NullLogger<EdgeSynchronizer>.Instance);
        IConfigChangeHandler[] handlers =
        [
            new MotorSessionDrainHandler(registry, sessionStore, TestMotorDiagnostics.Emitter(new NullDiagnosticsEventBus())),
            new EdgeSyncConfigHandler(edgeSynchronizer),
        ];

        store = new ConfigService(
            repository,
            loader,
            scriptStore,
            sessionStore,
            secrets,
            handlers,
            env,
            NullLogger<ConfigService>.Instance);

        return store;
    }

    private sealed class FakeWebHostEnvironment : IWebHostEnvironment
    {
        public string ApplicationName { get; set; } = "test";
        public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
        public string WebRootPath { get; set; } = "";
        public string EnvironmentName { get; set; } = "Development";
        public string ContentRootPath { get; set; } = "";
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }

    private sealed class HttpClientFactoryStub : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new HttpClient();
    }
}
