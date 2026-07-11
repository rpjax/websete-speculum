using Microsoft.AspNetCore.Mvc.Testing;

namespace Websete.Speculum.Host.Tests;

public sealed class SmokeTests : IClassFixture<WebApplicationFactory<Program>>, IDisposable
{
    private readonly WebApplicationFactory<Program> _factory;
    private readonly string _dbPath;
    private readonly HttpClient _client;
    private readonly string? _prevHttp;
    private readonly string? _prevDb;
    private readonly string? _prevSidecar;

    public SmokeTests(WebApplicationFactory<Program> factory)
    {
        _dbPath = Path.Combine(Path.GetTempPath(), $"speculum-smoke-{Guid.NewGuid():N}.db");

        _prevHttp    = Environment.GetEnvironmentVariable("HttpAddress");
        _prevDb      = Environment.GetEnvironmentVariable("Database__Path");
        _prevSidecar = Environment.GetEnvironmentVariable("Sidecar__BaseUrl");

        Environment.SetEnvironmentVariable("HttpAddress", "127.0.0.1:18080");
        Environment.SetEnvironmentVariable("Database__Path", _dbPath);
        Environment.SetEnvironmentVariable("Sidecar__BaseUrl", "ws://127.0.0.1:39999");

        _factory = factory;
        _client  = _factory.CreateClient();
    }

    [Fact]
    public async Task Health_returns_ok()
    {
        var response = await _client.GetAsync("/health");
        response.EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task Ready_returns_service_unavailable_when_unconfigured()
    {
        var response = await _client.GetAsync("/ready");
        Assert.Equal(System.Net.HttpStatusCode.ServiceUnavailable, response.StatusCode);
    }

    [Fact]
    public async Task Security_headers_are_present()
    {
        var response = await _client.GetAsync("/health");
        Assert.True(response.Headers.Contains("Content-Security-Policy"));
        Assert.True(response.Headers.Contains("X-Content-Type-Options"));
        Assert.True(response.Headers.Contains("X-Frame-Options"));
    }

    [Fact]
    public async Task Static_libs_are_public()
    {
        var signalr = await _client.GetAsync("/libs/signalr.min.js");
        signalr.EnsureSuccessStatusCode();

        var msgpack = await _client.GetAsync("/libs/signalr-protocol-msgpack.min.js");
        msgpack.EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task Static_js_is_public()
    {
        var clientJs = await _client.GetAsync("/js/speculum-client.js");
        clientJs.EnsureSuccessStatusCode();

        var setupJs = await _client.GetAsync("/js/setup-client.js");
        setupJs.EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task Static_worker_is_public()
    {
        var worker = await _client.GetAsync("/workers/frame-decode.js");
        worker.EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task Security_headers_include_strict_script_src()
    {
        var response = await _client.GetAsync("/health");
        var csp = response.Headers.GetValues("Content-Security-Policy").Single();
        Assert.Contains("script-src 'self'", csp);
        Assert.Contains("worker-src 'self'", csp);
    }

    [Fact]
    public async Task Setup_html_is_public_when_unconfigured()
    {
        var response = await _client.GetAsync("/setup.html");
        response.EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task Put_forwarding_is_not_blocked_by_setup_middleware_when_unconfigured()
    {
        var body = """{"host":"www.example.com","domains":["example.com"]}""";
        var request = new HttpRequestMessage(HttpMethod.Put, "/api/admin/config/Forwarding")
        {
            Content = new StringContent(body, System.Text.Encoding.UTF8, "application/json"),
        };

        var response = await _client.SendAsync(request);
        Assert.Equal(System.Net.HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task OpenApi_is_not_blocked_by_setup_middleware_when_unconfigured()
    {
        var response = await _client.GetAsync("/openapi/v1.json");
        Assert.Equal(System.Net.HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Root_redirects_to_setup_when_unconfigured()
    {
        var noRedirect = _factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
        });

        var response = await noRedirect.GetAsync("/");
        Assert.Equal(System.Net.HttpStatusCode.Redirect, response.StatusCode);
        Assert.Equal("/setup", response.Headers.Location?.OriginalString);
    }

    [Fact]
    public async Task Deep_link_issues_session_cookie()
    {
        var client = _factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            HandleCookies = false,
        });

        var response = await client.GetAsync("/cars?q=1");
        Assert.True(response.Headers.TryGetValues("Set-Cookie", out var cookies));
        Assert.Contains(cookies!, c => c.StartsWith("speculum_sid=", StringComparison.Ordinal));
    }

    public void Dispose()
    {
        _client.Dispose();
        Environment.SetEnvironmentVariable("HttpAddress", _prevHttp);
        Environment.SetEnvironmentVariable("Database__Path", _prevDb);
        Environment.SetEnvironmentVariable("Sidecar__BaseUrl", _prevSidecar);
        try { if (File.Exists(_dbPath)) File.Delete(_dbPath); } catch { /* best-effort */ }
    }
}
