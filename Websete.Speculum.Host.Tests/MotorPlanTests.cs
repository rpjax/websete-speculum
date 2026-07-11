using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using Websete.Speculum.Host.Config.Runtime;
using Websete.Speculum.Host.Config.Scripts;
using Websete.Speculum.Host.Config.Store;
using Websete.Speculum.Host.Virtualization;
using Websete.Speculum.Host.Virtualization.Contracts;
using Websete.Speculum.Host.Virtualization.Persistence;

namespace Websete.Speculum.Host.Tests;

public class BrowserSnapshotStoreTests : IDisposable
{
    private readonly string _tempDir;
    private readonly string _dbPath;

    public BrowserSnapshotStoreTests()
    {
        _tempDir = Path.Combine(Path.GetTempPath(), "speculum-snap-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_tempDir);
        _dbPath = Path.Combine(_tempDir, "speculum.db");
    }

    public void Dispose()
    {
        try { Directory.Delete(_tempDir, recursive: true); } catch { }
    }

    [Fact]
    public async Task SaveAndLoad_RoundTripsBlob()
    {
        var store = new BrowserSnapshotStore(_dbPath, NullLogger<BrowserSnapshotStore>.Instance);
        await store.InitializeAsync();

        var blob = new byte[] { 0x1F, 0x8B, 0x08, 0x00, 0x01, 0x02 };
        await store.SaveAsync("abc123", blob, "https://example.com/page", CancellationToken.None);

        var loaded = await store.TryLoadAsync("abc123");
        Assert.NotNull(loaded);
        Assert.Equal(blob, loaded!.ProfileBlob);
        Assert.Equal("https://example.com/page", loaded.LastUrl);
    }

    [Fact]
    public async Task PurgeExpired_RemovesOldSnapshots()
    {
        var store = new BrowserSnapshotStore(_dbPath, NullLogger<BrowserSnapshotStore>.Instance);
        await store.InitializeAsync();

        await store.SaveAsync("expired1", [1, 2, 3], "https://a.test", CancellationToken.None);

        await using var db = new Websete.Speculum.Host.Config.Persistence.SpeculumDbContext(_dbPath);
        await db.Database.ExecuteSqlRawAsync(
            "UPDATE browser_snapshots SET expires_at = {0} WHERE cookie_id = {1}",
            [DateTimeOffset.UtcNow.AddDays(-1).ToString("O"), "expired1"]);

        await store.PurgeExpiredAsync();
        Assert.Null(await store.TryLoadAsync("expired1"));
    }
}

public class SessionCookieMiddlewareTests
{
    [Fact]
    public async Task IssuesCookie_OnRootGet()
    {
        var issued = false;
        var middleware = new SessionCookieMiddleware(_ =>
        {
            issued = true;
            return Task.CompletedTask;
        }, new FakeHostEnvironment());

        var ctx = new DefaultHttpContext();
        ctx.Request.Method = HttpMethods.Get;
        ctx.Request.Path   = "/";

        await middleware.InvokeAsync(ctx);

        Assert.True(issued);
        Assert.True(ctx.Response.Headers.ContainsKey("Set-Cookie"));
        Assert.Contains("speculum_sid=", ctx.Response.Headers.SetCookie.ToString());
    }

    [Fact]
    public async Task PreservesExistingCookie()
    {
        var middleware = new SessionCookieMiddleware(_ => Task.CompletedTask, new FakeHostEnvironment());

        var ctx = new DefaultHttpContext();
        ctx.Request.Method = HttpMethods.Get;
        ctx.Request.Path   = "/";
        ctx.Request.Headers.Cookie = "speculum_sid=existing123";

        await middleware.InvokeAsync(ctx);

        Assert.False(ctx.Response.Headers.ContainsKey("Set-Cookie"));
        Assert.Equal("existing123", SessionCookieMiddleware.GetCookieId(ctx));
    }

    private sealed class FakeHostEnvironment : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = "Production";
        public string ApplicationName { get; set; } = "test";
        public string ContentRootPath { get; set; } = "";
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
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
}

public class VSessionRegistryTests
{
    [Fact]
    public void TryAcquireSlot_IsAtomic()
    {
        var registry = new VSessionRegistry();
        Assert.True(registry.TryAcquireSlot(2));
        Assert.True(registry.TryAcquireSlot(2));
        Assert.False(registry.TryAcquireSlot(2));
        registry.ReleaseSlot();
        Assert.True(registry.TryAcquireSlot(2));
    }

    [Fact]
    public void TryPromoteStarting_FailsAfterCancel()
    {
        var registry = new VSessionRegistry();
        var session  = new VSession(
            new Virtualization.Options.SidecarBrowserClientOptions { SidecarBaseUrl = "ws://localhost" },
            new SessionConfigSnapshot { InitialUrl = "https://example.com" },
            NullLogger.Instance);

        registry.TrackStarting("conn-1", session);
        Assert.True(registry.TryCancelStarting("conn-1", out _));
        Assert.False(registry.TryPromoteStarting("conn-1", session));
    }

    [Fact]
    public async Task StopAllAsync_releases_slot_for_starting_session()
    {
        var registry = new VSessionRegistry();
        var session  = new VSession(
            new Virtualization.Options.SidecarBrowserClientOptions { SidecarBaseUrl = "ws://localhost" },
            new SessionConfigSnapshot { InitialUrl = "https://example.com" },
            NullLogger.Instance);

        Assert.True(registry.TryAcquireSlot(10));
        registry.TrackStarting("conn-1", session);
        Assert.Equal(1, registry.ActiveCount);

        await registry.StopAllAsync(new NoOpMerger());

        Assert.Equal(0, registry.ActiveCount);
    }

    [Fact]
    public async Task Cancel_starting_before_reacquire_keeps_slot_count_correct()
    {
        var registry = new VSessionRegistry();
        var first = new VSession(
            new Virtualization.Options.SidecarBrowserClientOptions { SidecarBaseUrl = "ws://localhost" },
            new SessionConfigSnapshot { InitialUrl = "https://example.com" },
            NullLogger.Instance);
        var second = new VSession(
            new Virtualization.Options.SidecarBrowserClientOptions { SidecarBaseUrl = "ws://localhost" },
            new SessionConfigSnapshot { InitialUrl = "https://example.com/page" },
            NullLogger.Instance);

        Assert.True(registry.TryAcquireSlot(10));
        registry.TrackStarting("conn-1", first);
        Assert.True(registry.TryCancelStarting("conn-1", out _));
        registry.ReleaseSlot();

        Assert.True(registry.TryAcquireSlot(10));
        registry.TrackStarting("conn-1", second);
        Assert.Equal(1, registry.ActiveCount);

        await registry.StopAllAsync(new NoOpMerger());
        Assert.Equal(0, registry.ActiveCount);
    }

    private sealed class NoOpMerger : IProfileSnapshotMerger
    {
        public Task MergeAndSaveAsync(
            string cookieId, byte[] incomingBlob, string lastUrl, DateTimeOffset capturedAt, CancellationToken ct = default)
            => Task.CompletedTask;
    }
}
