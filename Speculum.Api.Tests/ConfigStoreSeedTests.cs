using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Logging.Abstractions;
using Speculum.Api.Config.Bootstrap;
using Speculum.Api.Config.Runtime;
using Speculum.Api.Config.Scripts;
using Speculum.Api.Config.Store;
using Speculum.Api.Scripts;
using Speculum.Api.Virtualization;
using Speculum.Api.Virtualization.Contracts;
using Speculum.Api.Virtualization.Persistence;

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

    private SpeculumConfigStore CreateStore()
    {
        Environment.SetEnvironmentVariable("HttpAddress", "127.0.0.1:8080");
        Environment.SetEnvironmentVariable("Database__Path", _dbPath);
        Environment.SetEnvironmentVariable("Sidecar__BaseUrl", "ws://127.0.0.1:3000");

        var config = new ConfigurationBuilder().AddEnvironmentVariables().Build();
        var bootstrap = BootstrapConfig.Load(config);
        var env = new FakeWebHostEnvironment { WebRootPath = _tempDir };
        var registry = new VSessionRegistry();
        var scriptStore = new InjectedScriptStore(_dbPath);
        var sessionStore = new BrowserSessionStore(_dbPath, NullLogger<BrowserSessionStore>.Instance);
        var resolver = new ScriptResolver(
            new HttpClientFactoryStub(),
            scriptStore,
            NullLogger<ScriptResolver>.Instance);

        return new SpeculumConfigStore(
            _dbPath,
            bootstrap,
            resolver,
            scriptStore,
            registry,
            sessionStore,
            env,
            NullLogger<SpeculumConfigStore>.Instance,
            EmptyServiceProvider.Instance,
            config);
    }

    private sealed class EmptyServiceProvider : IServiceProvider
    {
        public static readonly EmptyServiceProvider Instance = new();
        public object? GetService(Type serviceType) => null;
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
