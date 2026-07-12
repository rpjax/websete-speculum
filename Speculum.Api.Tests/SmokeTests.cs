namespace Speculum.Api.Tests;

public sealed class SmokeTests : IClassFixture<SpeculumWebApplicationFactory>, IDisposable
{
    private readonly HttpClient _client;

    public SmokeTests(SpeculumWebApplicationFactory factory)
    {
        _client = factory.CreateClient();
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
        Assert.True(response.Headers.Contains("X-Content-Type-Options"));
        Assert.False(response.Headers.Contains("Content-Security-Policy"));
    }

    [Fact]
    public async Task Unknown_route_returns_not_found()
    {
        var response = await _client.GetAsync("/");
        Assert.Equal(System.Net.HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Cors_preflight_allows_configured_origin()
    {
        var request = new HttpRequestMessage(HttpMethod.Options, "/health");
        request.Headers.Add("Origin", "http://localhost:5173");
        request.Headers.Add("Access-Control-Request-Method", "GET");

        var response = await _client.SendAsync(request);
        Assert.True(response.Headers.Contains("Access-Control-Allow-Origin"));
        Assert.Equal("http://localhost:5173", response.Headers.GetValues("Access-Control-Allow-Origin").Single());
    }

    [Fact]
    public async Task Put_forwarding_requires_auth_when_unconfigured()
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
    public async Task OpenApi_requires_auth_when_unconfigured()
    {
        var response = await _client.GetAsync("/openapi/v1.json");
        Assert.Equal(System.Net.HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Config_status_is_public_when_unconfigured()
    {
        var response = await _client.GetAsync("/api/admin/config/status");
        response.EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task Client_config_is_public()
    {
        var response = await _client.GetAsync("/api/public/client-config");
        response.EnsureSuccessStatusCode();
    }

    public void Dispose()
    {
        _client.Dispose();
        try
        {
            if (File.Exists(SpeculumWebApplicationFactory.DbPath))
                File.Delete(SpeculumWebApplicationFactory.DbPath);
        }
        catch { /* best-effort */ }
    }
}
