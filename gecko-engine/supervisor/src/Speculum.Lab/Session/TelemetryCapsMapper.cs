using System.Text.Json;

namespace Speculum.Lab.Session;

/// <summary>
/// Mapeia <c>browse.start.telemetry</c> (schema ProjectionTelemetry) → caps Gecko.
/// Caps finos Chromium ficam no Projected; aqui só EVENTS/METRICS.
/// </summary>
public static class TelemetryCapsMapper
{
    public static (bool Events, bool Metrics) FromBrowseStart(JsonElement? telemetry)
    {
        // Default lab = LAB_TELEMETRY_DEFAULTS (enabled + clock).
        if (telemetry is null || telemetry.Value.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null)
        {
            return (true, true);
        }

        var el = telemetry.Value;
        var enabled = ReadBool(el, "enabled", defaultValue: true);
        if (!enabled)
        {
            return (false, false);
        }

        var clock = ReadBool(el, "clock", defaultValue: true);
        return (true, clock);
    }

    private static bool ReadBool(JsonElement el, string name, bool defaultValue)
    {
        if (el.ValueKind != JsonValueKind.Object || !el.TryGetProperty(name, out var p))
        {
            return defaultValue;
        }

        return p.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => defaultValue,
        };
    }
}
