using System.Text.Json;
using Speculum.Api.Diagnostics.Redaction;

namespace Speculum.Api.Tests;

public sealed class DiagnosticsRedactorTests
{
    [Fact]
    public void ProductionMarketRedactor_masks_secret_and_token_fields()
    {
        var redactor = new ProductionMarketRedactor();
        var payload = new
        {
            secret = "top-secret",
            token = "bearer-token",
            apiKey = "key-123",
            password = "hunter2",
        };

        var result = redactor.RedactPayload(payload);
        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(result));

        Assert.Equal("***", doc.RootElement.GetProperty("secret").GetString());
        Assert.Equal("***", doc.RootElement.GetProperty("token").GetString());
        Assert.Equal("***", doc.RootElement.GetProperty("apiKey").GetString());
        Assert.Equal("***", doc.RootElement.GetProperty("password").GetString());
    }

    [Fact]
    public void ProductionMarketRedactor_masks_clientTokenEffective_as_identity_not_secret()
    {
        var redactor = new ProductionMarketRedactor();
        var payload = new
        {
            clientTokenEffective = "abcdef0123456789abcdef0123456789",
            clientTokenProvided = true,
            errorCode = "cookie_import_invalid",
            message = "Network.setCookies: Invalid parameters",
        };

        var result = redactor.RedactPayload(payload);
        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(result));
        var p = doc.RootElement;

        Assert.NotEqual("***", p.GetProperty("clientTokenEffective").GetString());
        Assert.Contains("…", p.GetProperty("clientTokenEffective").GetString()!, StringComparison.Ordinal);
        Assert.True(p.GetProperty("clientTokenProvided").GetBoolean());
        Assert.Equal("cookie_import_invalid", p.GetProperty("errorCode").GetString());
        Assert.Equal("Network.setCookies: Invalid parameters", p.GetProperty("message").GetString());
    }

    [Fact]
    public void DevelopmentIdentityRedactor_leaves_secret_and_token_fields()
    {
        var redactor = new DevelopmentIdentityRedactor();
        var payload = new
        {
            secret = "top-secret",
            token = "bearer-token",
            clientToken = "client-token-abc",
        };

        var result = redactor.RedactPayload(payload);

        Assert.Same(payload, result);
    }
}
