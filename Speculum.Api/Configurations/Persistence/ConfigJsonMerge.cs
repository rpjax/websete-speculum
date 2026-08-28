using System.Text.Json.Nodes;

namespace Speculum.Api.Configurations.Persistence;

/// <summary>
/// Deep-merge helpers for configuration section JSON (overlay wins; arrays replaced wholesale).
/// </summary>
public static class ConfigJsonMerge
{
    /// <summary>
    /// Deep-merge <paramref name="overlay"/> onto <paramref name="baseline"/>.
    /// Property names match case-insensitively.
    /// </summary>
    public static JsonNode? Merge(JsonNode? baseline, JsonNode? overlay)
    {
        if (overlay is null)
            return baseline?.DeepClone();
        if (baseline is null)
            return overlay.DeepClone();

        if (baseline is JsonObject baseObj && overlay is JsonObject overObj)
        {
            var result = (JsonObject)baseObj.DeepClone()!;
            foreach (var (key, value) in overObj)
            {
                var existing = FindCaseInsensitive(result, key);
                RemoveCaseInsensitiveKey(result, key);

                if (value is null)
                {
                    result[key] = null;
                    continue;
                }

                result[key] = existing is JsonObject && value is JsonObject
                    ? Merge(existing, value)
                    : value.DeepClone();
            }

            return result;
        }

        return overlay.DeepClone();
    }

    public static string MergeSectionJson(string? baselineJson, string overlayJson)
    {
        JsonNode? baseline = string.IsNullOrWhiteSpace(baselineJson)
            ? null
            : JsonNode.Parse(baselineJson);
        var overlay = JsonNode.Parse(overlayJson)
            ?? throw new InvalidOperationException("Overlay JSON is invalid.");

        return Merge(baseline, overlay)?.ToJsonString(ConfigSectionStore.SerializerOptions)
            ?? overlayJson;
    }

    /// <summary>
    /// Telemetry PUT merge: deep-merge sampling sections, but replace <c>events</c> wholesale
    /// when the overlay includes it so seeds/Lab can deterministically enable/disable facts.
    /// </summary>
    public static string MergeTelemetrySectionJson(string? baselineJson, string overlayJson)
    {
        JsonNode? baseline = string.IsNullOrWhiteSpace(baselineJson)
            ? null
            : JsonNode.Parse(baselineJson);
        var overlay = JsonNode.Parse(overlayJson)
            ?? throw new InvalidOperationException("Overlay JSON is invalid.");

        JsonNode? overlayEvents = null;
        var replaceEvents = false;
        if (overlay is JsonObject overlayObj)
        {
            foreach (var (key, value) in overlayObj)
            {
                if (!string.Equals(key, "events", StringComparison.OrdinalIgnoreCase))
                    continue;
                replaceEvents = true;
                overlayEvents = value?.DeepClone();
                break;
            }

            if (replaceEvents)
                RemoveCaseInsensitiveKey(overlayObj, "events");
        }

        var merged = Merge(baseline, overlay) as JsonObject
            ?? new JsonObject();

        if (replaceEvents)
        {
            RemoveCaseInsensitiveKey(merged, "events");
            merged["events"] = overlayEvents ?? new JsonObject();
        }

        return merged.ToJsonString(ConfigSectionStore.SerializerOptions);
    }

    private static JsonNode? FindCaseInsensitive(JsonObject obj, string key)
    {
        foreach (var (candidate, value) in obj)
        {
            if (string.Equals(candidate, key, StringComparison.OrdinalIgnoreCase))
                return value;
        }

        return null;
    }

    private static void RemoveCaseInsensitiveKey(JsonObject obj, string key)
    {
        string? match = null;
        foreach (var candidate in obj)
        {
            if (string.Equals(candidate.Key, key, StringComparison.OrdinalIgnoreCase))
            {
                match = candidate.Key;
                break;
            }
        }

        if (match is not null)
            obj.Remove(match);
    }
}
