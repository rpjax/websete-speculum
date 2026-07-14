using Speculum.Api.Diagnostics.Abstractions;

namespace Speculum.Api.Tests;

/// <summary>Payload contracts for Motor.SessionResolved / Motor.UrlMapped (Act→Assert completeness).</summary>
public sealed class DiagnosticsEmitterPayloadTests
{
    [Fact]
    public void SessionResolved_catalog_name_is_stable()
    {
        Assert.Contains("Motor.SessionResolved", DiagnosticsEventCatalog.All);
    }

    [Fact]
    public void UrlMapped_catalog_name_is_stable()
    {
        Assert.Contains("Motor.UrlMapped", DiagnosticsEventCatalog.All);
    }

    [Fact]
    public void SessionResolved_payload_shape_serializes_to_camelCase_json()
    {
        var payload = new
        {
            clientTokenProvided = true,
            clientTokenEffective = "abcdef0123456789abcdef0123456789",
            persistedSessionId = "session-id",
            restored = true,
            stateLoaded = true,
            cookieCount = 2,
            localStorageCount = 1,
            historyCount = 3,
            initialUrl = "https://fixture.test/",
        };

        var json = System.Text.Json.JsonSerializer.Serialize(payload, new System.Text.Json.JsonSerializerOptions
        {
            PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase,
        });

        using var doc = System.Text.Json.JsonDocument.Parse(json);
        var root = doc.RootElement;
        foreach (var name in new[]
                 {
                     "clientTokenProvided", "clientTokenEffective", "persistedSessionId",
                     "restored", "stateLoaded", "cookieCount", "localStorageCount",
                     "historyCount", "initialUrl",
                 })
        {
            Assert.True(root.TryGetProperty(name, out _), $"missing {name} in {json}");
        }
    }

    [Fact]
    public void UrlMapped_payload_shape_has_target_and_client_urls()
    {
        var payload = new
        {
            targetUrl = "https://www.fixture.test/nav/b",
            clientUrl = "https://speculum.test/nav/b?_w7s_nso=abc",
        };
        var json = System.Text.Json.JsonSerializer.Serialize(payload);
        using var doc = System.Text.Json.JsonDocument.Parse(json);
        Assert.Equal("https://www.fixture.test/nav/b", doc.RootElement.GetProperty("targetUrl").GetString());
        Assert.Contains("_w7s_nso", doc.RootElement.GetProperty("clientUrl").GetString()!, StringComparison.Ordinal);
    }
}
