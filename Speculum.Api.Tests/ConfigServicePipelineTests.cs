using System.Diagnostics.CodeAnalysis;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Logging.Abstractions;
using Speculum.Api.Config.Application;
using Speculum.Api.Config.Bootstrap;
using Speculum.Api.Config.Persistence;
using Speculum.Api.Config.Runtime;
using Speculum.Api.Config.Store;
using Speculum.Api.Diagnostics.Abstractions;
using Speculum.Api.Edge;
using Speculum.Api.Motor.Live;
using Speculum.Api.Scripts;
using Speculum.Api.BrowserPersistence;

namespace Speculum.Api.Tests;

public sealed class ConfigServicePipelineTests : IDisposable
{
    private readonly string _tempDir;
    private readonly string _dbPath;

    public ConfigServicePipelineTests()
    {
        _tempDir = Path.Combine(Path.GetTempPath(), "speculum-pipeline-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_tempDir);
        _dbPath = Path.Combine(_tempDir, "speculum.db");
    }

    public void Dispose()
    {
        Environment.SetEnvironmentVariable("HttpAddress", null);
        Environment.SetEnvironmentVariable("Database__Path", null);
        Environment.SetEnvironmentVariable("Sidecar__BaseUrl", null);
        try { Directory.Delete(_tempDir, recursive: true); }
        catch { /* best-effort */ }
    }

    [Fact]
    public async Task Put_Hosting_synchronizes_edge_once_in_post_reload()
    {
        var sync = new RecordingEdgeSynchronizer();
        var registry = new RecordingMotorSessionRegistry();
        var store = CreateStore(sync, registry);

        await store.InitializeAsync();
        var syncAfterInit = sync.SyncCount;
        Assert.True(syncAfterInit >= 1);

        var result = await store.PutSectionAsync(
            ConfigSectionKeys.Hosting,
            JsonDocument.Parse("""{"acmeEmail":"a@b.com","profiles":[]}""").RootElement);

        Assert.True(result.Success);
        Assert.Equal(syncAfterInit + 1, sync.SyncCount);
        Assert.Equal(1, registry.StopAllCount);
    }

    [Fact]
    public async Task Put_Forwarding_drains_sessions_without_edge_sync()
    {
        var sync = new RecordingEdgeSynchronizer();
        var registry = new RecordingMotorSessionRegistry();
        var store = CreateStore(sync, registry);
        await store.InitializeAsync();

        await store.PutSectionAsync(ConfigSectionKeys.Forwarding,
            JsonDocument.Parse("""
            { "host": "www.example.com", "domains": ["example.com", "*.example.com"] }
            """).RootElement);
        await store.PutSectionAsync(ConfigSectionKeys.MaxSessions,
            JsonDocument.Parse("2").RootElement);

        sync.ResetCount();
        registry.ResetCount();

        var result = await store.PutSectionAsync(ConfigSectionKeys.Forwarding,
            JsonDocument.Parse("""
            { "host": "www.example.com", "domains": ["example.com", "*.example.com", "www.example.com"] }
            """).RootElement);

        Assert.True(result.Success);
        Assert.Equal(1, registry.StopAllCount);
        Assert.Equal(0, sync.SyncCount);
    }

    [Fact]
    public async Task Put_MaxSessions_does_not_drain_or_sync()
    {
        var sync = new RecordingEdgeSynchronizer();
        var registry = new RecordingMotorSessionRegistry();
        var store = CreateStore(sync, registry);
        await store.InitializeAsync();

        sync.ResetCount();
        registry.ResetCount();

        var result = await store.PutSectionAsync(ConfigSectionKeys.MaxSessions,
            JsonDocument.Parse("3").RootElement);

        Assert.True(result.Success);
        Assert.Equal(0, registry.StopAllCount);
        Assert.Equal(0, sync.SyncCount);
    }

    private ConfigService CreateStore(
        RecordingEdgeSynchronizer sync,
        RecordingMotorSessionRegistry registry)
    {
        Environment.SetEnvironmentVariable("HttpAddress", "127.0.0.1:8080");
        Environment.SetEnvironmentVariable("Database__Path", _dbPath);
        Environment.SetEnvironmentVariable("Sidecar__BaseUrl", "ws://127.0.0.1:3000");

        var config = new ConfigurationBuilder().AddEnvironmentVariables().Build();
        var bootstrap = BootstrapConfig.Load(config);
        var env = new FakeWebHostEnvironment { WebRootPath = _tempDir };
        var scriptStore = new InjectedScriptStore(_dbPath);
        var sessionStore = new BrowserSessionStore(_dbPath, NullLogger<BrowserSessionStore>.Instance);
        var resolver = new ScriptResolver(
            new HttpClientFactoryStub(),
            scriptStore,
            NullLogger<ScriptResolver>.Instance);

        var repository = new ConfigSectionRepository(_dbPath);
        var loader = new ConfigLoader(resolver, NullLogger<ConfigLoader>.Instance);
        var secrets = new MotorSecretsStore(_dbPath);

        IConfigChangeHandler[] handlers =
        [
            new MotorSessionDrainHandler(registry, sessionStore, new NullDiagnosticsEventBus()),
            new EdgeSyncConfigHandler(sync),
        ];

        return new ConfigService(
            repository,
            loader,
            scriptStore,
            sessionStore,
            secrets,
            handlers,
            env,
            NullLogger<ConfigService>.Instance);
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

    private sealed class RecordingEdgeSynchronizer : IEdgeSynchronizer
    {
        public int SyncCount { get; private set; }

        public Task SynchronizeAsync(CancellationToken ct = default)
        {
            SyncCount++;
            return Task.CompletedTask;
        }

        public void ResetCount() => SyncCount = 0;
    }

    private sealed class RecordingMotorSessionRegistry : IMotorSessionRegistry
    {
        public int StopAllCount { get; private set; }
        public int ActiveCount => 0;
        public int StartingCount => 0;

        public void Register(string connectionId, IMotorSession session) { }
        public IMotorSession? Get(string connectionId) => null;
        public bool TryRemove(string connectionId, [NotNullWhen(true)] out IMotorSession? session)
        {
            session = null;
            return false;
        }
        public bool TryAcquireSlot(int max) => true;
        public void ReleaseSlot() { }
        public void TrackStarting(string connectionId, IMotorSession session) { }
        public bool TryPromoteStarting(string connectionId, IMotorSession session) => true;
        public bool TryCancelStarting(string connectionId, [NotNullWhen(true)] out IMotorSession? session)
        {
            session = null;
            return false;
        }

        public IReadOnlyList<MotorSessionListItem> ListSessions() => [];

        public bool TryFindByPersistedSessionId(
            string persistedSessionId,
            [NotNullWhen(true)] out IMotorSession? session,
            [NotNullWhen(true)] out string? connectionId)
        {
            session = null;
            connectionId = null;
            return false;
        }

        public bool TryFindBySidecarSessionId(
            string sidecarSessionId,
            [NotNullWhen(true)] out IMotorSession? session,
            [NotNullWhen(true)] out string? connectionId)
        {
            session = null;
            connectionId = null;
            return false;
        }

        public Task StopAllAsync(IBrowserSessionStore sessionStore, CancellationToken ct = default)
        {
            StopAllCount++;
            return Task.CompletedTask;
        }

        public void ResetCount() => StopAllCount = 0;
    }
}
