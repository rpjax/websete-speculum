using Speculum.Api.Diagnostics.Abstractions;
using Speculum.Api.Motor.Diagnostics;

namespace Speculum.Api.Tests;

/// <summary>Payload contracts for Motor.SessionResolved / Motor.UrlMapped (Act→Assert completeness).</summary>
public sealed class DiagnosticsEmitterPayloadTests
{
    private static readonly System.Text.Json.JsonSerializerOptions CamelCase = new()
    {
        PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase,
    };

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
        var payload = new MotorSessionResolvedPayload(
            ClientTokenProvided: true,
            ClientTokenEffective: "abcdef0123456789abcdef0123456789",
            Restored: true,
            StateLoaded: true,
            CookieCount: 2,
            LocalStorageCount: 1,
            HistoryCount: 3,
            InitialUrl: "https://fixture.test/");

        var json = System.Text.Json.JsonSerializer.Serialize(payload, CamelCase);

        using var doc = System.Text.Json.JsonDocument.Parse(json);
        var root = doc.RootElement;
        foreach (var name in new[]
                 {
                     "clientTokenProvided", "clientTokenEffective",
                     "restored", "stateLoaded", "cookieCount", "localStorageCount",
                     "historyCount", "initialUrl",
                 })
        {
            Assert.True(root.TryGetProperty(name, out _), $"missing {name} in {json}");
        }

        // Identity is dedup'd onto the envelope; the payload must not carry it.
        Assert.False(root.TryGetProperty("persistedSessionId", out _));
    }

    [Fact]
    public void UrlMapped_payload_shape_has_target_and_client_urls()
    {
        var payload = new MotorUrlMappedPayload(
            TargetUrl: "https://www.fixture.test/nav/b",
            ClientUrl: "https://speculum.test/nav/b?_w7s_nso=abc");
        var json = System.Text.Json.JsonSerializer.Serialize(payload, CamelCase);
        using var doc = System.Text.Json.JsonDocument.Parse(json);
        Assert.Equal("https://www.fixture.test/nav/b", doc.RootElement.GetProperty("targetUrl").GetString());
        Assert.Contains("_w7s_nso", doc.RootElement.GetProperty("clientUrl").GetString()!, StringComparison.Ordinal);
    }
}
