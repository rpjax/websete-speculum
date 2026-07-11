using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Logging.Abstractions;
using Websete.Speculum.Host.Config.Runtime;
using Websete.Speculum.Host.Config.Scripts;
using Websete.Speculum.Host.Config.Store;
using Websete.Speculum.Host.Scripts;
using Websete.Speculum.Host.Virtualization;
using Websete.Speculum.Host.Virtualization.Contracts;
using Websete.Speculum.Host.Virtualization.Persistence;

namespace Websete.Speculum.Host.Tests;

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
        try { Directory.Delete(_tempDir, recursive: true); }
        catch { /* best-effort */ }
    }

    [Fact]
    public async Task Seed_WritesBootstrapAdminOnly_WhenDbEmpty()
    {
        Environment.SetEnvironmentVariable(SpeculumConfigStore.BootstrapKeyEnvVar, "test-bootstrap-key");

        var store = CreateStore();
        await store.InitializeAsync();

        Assert.False(store.IsOperational);
        Assert.Equal("test-bootstrap-key", store.Current.AdminApiKey);
        Assert.Null(store.Current.Forwarding);
        Assert.Null(store.Current.MaxSessions);

        Environment.SetEnvironmentVariable(SpeculumConfigStore.BootstrapKeyEnvVar, null);
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
        await store.PutSectionAsync(ConfigSectionKeys.Admin,
            JsonDocument.Parse("""{ "apiKey": "custom-key" }""").RootElement);

        var store2 = CreateStore();
        await store2.InitializeAsync();

        Assert.True(store2.IsOperational);
        Assert.Equal("www.example.com", store2.Current.Forwarding!.Host);
        Assert.Equal(5, store2.Current.MaxSessions);
        Assert.Equal("custom-key", store2.Current.AdminApiKey);
    }

    private SpeculumConfigStore CreateStore()
    {
        var env = new FakeWebHostEnvironment { WebRootPath = _tempDir };
        var registry = new VSessionRegistry();
        var scriptStore = new InjectedScriptStore(_dbPath);
        var resolver = new ScriptResolver(
            new HttpClientFactoryStub(),
            scriptStore,
            NullLogger<ScriptResolver>.Instance);

        return new SpeculumConfigStore(
            _dbPath,
            resolver,
            scriptStore,
            registry,
            new FakeProfileSnapshotMerger(),
            new BrowserSnapshotStore(_dbPath, NullLogger<BrowserSnapshotStore>.Instance),
            env,
            NullLogger<SpeculumConfigStore>.Instance);
    }

    private sealed class FakeProfileSnapshotMerger : IProfileSnapshotMerger
    {
        public Task MergeAndSaveAsync(
            string cookieId,
            byte[] incomingBlob,
            string lastUrl,
            DateTimeOffset capturedAt,
            CancellationToken ct = default)
            => Task.CompletedTask;
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
