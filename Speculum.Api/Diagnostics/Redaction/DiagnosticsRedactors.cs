using System.Text.Json;
using Speculum.Api.Diagnostics.Abstractions;

namespace Speculum.Api.Diagnostics.Redaction;

public sealed class DevelopmentIdentityRedactor : IDiagnosticsRedactor
{
    public string Mode => "none";

    public object? RedactPayload(object? payload) => payload;

    public object RedactSessionSnapshot(object snapshot) => snapshot;

    public object RedactPersistedDetail(object detail) => detail;

    public object RedactProbeResult(object result) => result;
}

public sealed class ProductionMarketRedactor : IDiagnosticsRedactor
{
    public string Mode => "production";

    public object? RedactPayload(object? payload)
        => RedactObject(payload);

    public object RedactSessionSnapshot(object snapshot)
        => RedactObject(snapshot)!;

    public object RedactPersistedDetail(object detail)
        => RedactObject(detail)!;

    public object RedactProbeResult(object result)
        => RedactObject(result)!;

    private static object? RedactObject(object? value)
    {
        if (value is null) return null;

        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(value));
        return RedactElement(doc.RootElement);
    }

    private static object? RedactElement(JsonElement el)
    {
        return el.ValueKind switch
        {
            JsonValueKind.Object => RedactObjectElement(el),
            JsonValueKind.Array => el.EnumerateArray().Select(RedactElement).ToArray(),
            JsonValueKind.String => el.GetString(),
            JsonValueKind.Number => el.TryGetInt64(out var l) ? l : el.GetDouble(),
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => null,
        };
    }

    private static Dictionary<string, object?> RedactObjectElement(JsonElement el)
    {
        var map = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
        foreach (var prop in el.EnumerateObject())
        {
            var name = prop.Name;
            if (IsSecretField(name))
            {
                map[name] = "***";
                continue;
            }

            if (IsIdentityField(name) && prop.Value.ValueKind == JsonValueKind.String)
            {
                map[name] = MaskIdentity(prop.Value.GetString());
                continue;
            }

            if (IsDomField(name) && prop.Value.ValueKind == JsonValueKind.String)
            {
                var text = prop.Value.GetString() ?? "";
                map[name] = text.Length <= 256 ? text : text[..256] + "…";
                continue;
            }

            map[name] = RedactElement(prop.Value);
        }

        return map;
    }

    private static bool IsSecretField(string name)
        => name.Contains("password", StringComparison.OrdinalIgnoreCase)
           || name.Contains("secret", StringComparison.OrdinalIgnoreCase)
           || name.Contains("apiKey", StringComparison.OrdinalIgnoreCase)
           || name.Contains("token", StringComparison.OrdinalIgnoreCase)
           || name.Equals("value", StringComparison.OrdinalIgnoreCase)
           || name.Equals("cookieValue", StringComparison.OrdinalIgnoreCase);

    private static bool IsIdentityField(string name)
        => name.Equals("clientToken", StringComparison.OrdinalIgnoreCase)
           || name.Equals("connectionId", StringComparison.OrdinalIgnoreCase)
           || name.Equals("persistedSessionId", StringComparison.OrdinalIgnoreCase)
           || name.Equals("sidecarSessionId", StringComparison.OrdinalIgnoreCase)
           || name.Equals("correlationId", StringComparison.OrdinalIgnoreCase);

    private static bool IsDomField(string name)
        => name.Equals("outerHTML", StringComparison.OrdinalIgnoreCase)
           || name.Equals("html", StringComparison.OrdinalIgnoreCase)
           || name.Equals("text", StringComparison.OrdinalIgnoreCase)
           || name.Equals("evaluateResult", StringComparison.OrdinalIgnoreCase);

    private static string MaskIdentity(string? value)
    {
        if (string.IsNullOrEmpty(value)) return "";
        if (value.Length <= 8) return "***";
        return value[..4] + "…" + value[^2..];
    }
}
