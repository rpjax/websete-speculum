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
