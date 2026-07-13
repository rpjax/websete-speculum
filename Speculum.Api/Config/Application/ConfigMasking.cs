using System.Text.Json;
using Speculum.Api.Config.Runtime;

namespace Speculum.Api.Config.Application;

public static class ConfigMasking
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
    };

    public static JsonElement MaskHosting(string json)
    {
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        if (!root.TryGetProperty("profiles", out var profiles) || profiles.ValueKind != JsonValueKind.Array)
            return root.Clone();

        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream))
        {
            writer.WriteStartObject();
            foreach (var prop in root.EnumerateObject())
            {
                if (!prop.NameEquals("profiles"))
                {
                    prop.WriteTo(writer);
                    continue;
                }

                writer.WritePropertyName("profiles");
                writer.WriteStartArray();
                foreach (var profile in profiles.EnumerateArray())
                {
                    if (profile.ValueKind != JsonValueKind.Object
                        || !profile.TryGetProperty("edgeTls", out var edgeTls)
                        || edgeTls.ValueKind != JsonValueKind.Object)
                    {
                        profile.WriteTo(writer);
                        continue;
                    }

                    writer.WriteStartObject();
                    foreach (var p in profile.EnumerateObject())
                    {
                        if (!p.NameEquals("edgeTls"))
                        {
                            p.WriteTo(writer);
                            continue;
                        }

                        writer.WritePropertyName("edgeTls");
                        writer.WriteStartObject();
                        foreach (var ep in edgeTls.EnumerateObject())
                        {
                            if (ep.NameEquals("apiToken") && ep.Value.ValueKind == JsonValueKind.String)
                            {
                                writer.WriteString("apiToken", "***");
                                continue;
                            }

                            ep.WriteTo(writer);
                        }
                        writer.WriteEndObject();
                    }
                    writer.WriteEndObject();
                }
                writer.WriteEndArray();
            }
            writer.WriteEndObject();
        }

        using var masked = JsonDocument.Parse(stream.ToArray());
        return masked.RootElement.Clone();
    }

    public static async Task<JsonElement> MergeHostingPutAsync(
        JsonElement body,
        Func<string, CancellationToken, Task<string?>> getSectionRawAsync,
        CancellationToken ct)
    {
        if (body.ValueKind != JsonValueKind.Object
            || !body.TryGetProperty("profiles", out var profiles)
            || profiles.ValueKind != JsonValueKind.Array)
        {
            return body;
        }

        var existing = await getSectionRawAsync(ConfigSectionKeys.Hosting, ct);
        Dictionary<string, string>? tokenByDomain = null;
        if (existing is not null)
        {
            try
            {
                var prev = JsonSerializer.Deserialize<HostingOptions>(existing, JsonOptions);
                tokenByDomain = prev?.Profiles
                    .Where(p => p.EdgeTls?.ApiToken is not null)
                    .ToDictionary(p => p.Domain, p => p.EdgeTls!.ApiToken!, StringComparer.OrdinalIgnoreCase);
            }
            catch { /* ignore */ }
        }

        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream))
        {
            writer.WriteStartObject();
            foreach (var prop in body.EnumerateObject())
            {
                if (!prop.NameEquals("profiles"))
                {
                    prop.WriteTo(writer);
                    continue;
                }

                writer.WritePropertyName("profiles");
                writer.WriteStartArray();
                foreach (var profile in profiles.EnumerateArray())
                {
                    if (profile.ValueKind != JsonValueKind.Object)
                    {
                        profile.WriteTo(writer);
                        continue;
                    }

                    var domain = profile.TryGetProperty("domain", out var dEl) && dEl.ValueKind == JsonValueKind.String
                        ? dEl.GetString()?.Trim() ?? ""
                        : "";

                    var needsTokenMerge = profile.TryGetProperty("edgeTls", out var edgeTls)
                                          && edgeTls.ValueKind == JsonValueKind.Object
                                          && edgeTls.TryGetProperty("apiToken", out var tokenEl)
                                          && tokenEl.ValueKind == JsonValueKind.String
                                          && tokenEl.GetString() == "***";

                    string? existingToken = null;
                    if (needsTokenMerge && tokenByDomain is not null && !string.IsNullOrEmpty(domain)
                        && tokenByDomain.TryGetValue(domain, out var byDomain))
                    {
                        existingToken = byDomain;
                    }

                    if (!needsTokenMerge || existingToken is null)
                    {
                        profile.WriteTo(writer);
                        continue;
                    }

                    writer.WriteStartObject();
                    foreach (var p in profile.EnumerateObject())
                    {
                        if (!p.NameEquals("edgeTls"))
                        {
                            p.WriteTo(writer);
                            continue;
                        }

                        writer.WritePropertyName("edgeTls");
                        writer.WriteStartObject();
                        foreach (var ep in edgeTls.EnumerateObject())
                        {
                            if (ep.NameEquals("apiToken"))
                            {
                                writer.WriteString("apiToken", existingToken);
                                continue;
                            }

                            ep.WriteTo(writer);
                        }
                        writer.WriteEndObject();
                    }
                    writer.WriteEndObject();
                }
                writer.WriteEndArray();
            }
            writer.WriteEndObject();
        }

        using var merged = JsonDocument.Parse(stream.ToArray());
        return merged.RootElement.Clone();
    }
}
