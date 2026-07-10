using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Logging.Abstractions;
using Websete.Speculum.Host.Config.Scripts;
using Websete.Speculum.Host.Config.Store;
using Websete.Speculum.Host.Virtualization;
using Websete.Speculum.Host.Virtualization.Contracts;

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
    public async Task Seed_WritesAppsettingsToDb_WhenDbEmpty()
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Forwarding:Host"]    = "www.example.com",
                ["Forwarding:Domains:0"] = "example.com",
                ["Forwarding:Domains:1"] = "*.example.com",
                ["MaxSessions"]        = "5",
                ["Environment"]        = "Dev",
            })
            .Build();

        var store = CreateStore(config);
        await store.InitializeAsync();

        Assert.True(store.IsOperational);

        // Second init with different appsettings must not overwrite DB.
        var config2 = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Forwarding:Host"] = "www.other.com",
                ["Forwarding:Domains:0"] = "other.com",
                ["MaxSessions"]     = "99",
                ["Environment"]     = "Prod",
            })
            .Build();

        var store2 = CreateStore(config2);
        await store2.InitializeAsync();

        Assert.Equal("www.example.com", store2.Current.Forwarding!.Host);
        Assert.Equal(5, store2.Current.MaxSessions);
    }

    private SpeculumConfigStore CreateStore(IConfiguration config)
    {
        var env = new FakeWebHostEnvironment { WebRootPath = _tempDir };
        var registry = new VSessionRegistry();
        var resolver = new ScriptResolver(
            new HttpClientFactoryStub(),
            env,
            NullLogger<ScriptResolver>.Instance);

        return new SpeculumConfigStore(
            _dbPath,
            config,
            resolver,
            registry,
            env,
            NullLogger<SpeculumConfigStore>.Instance);
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
