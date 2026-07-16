using System.Text.Json;
using Speculum.Api.Config.Store;

namespace Speculum.Api.Motor.Live;

/// <summary>
/// Validates commands relayed from hub clients to the sidecar.
/// </summary>
internal static class SidecarInputGuard
{
    public const int MaxKeyChars = 64;
    public const int MaxTextChars = 4096;
    public const int MaxTouchPoints = ViewportDimensions.MaxTouchPoints;
    public const double MinCoord = -10_000;
    public const double MaxCoord = 20_000;

    private static readonly HashSet<string> AllowedUserInputTypes = new(StringComparer.Ordinal)
    {
        "mousemove",
        "mousedown",
        "mouseup",
        "wheel",
        "keydown",
        "keyup",
        "goback",
        "goforward",
        "touch",
        "text",
    };

    private static readonly HashSet<string> TouchPhases = new(StringComparer.Ordinal)
    {
        "start", "move", "end", "cancel",
    };

    public static bool IsNavigationUrlAllowed(string url, IReadOnlyList<string> allowedDomains)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)
            || uri.Scheme is not "http" and not "https")
        {
            return false;
        }

        return DomainMatcher.MatchesAny(uri.Host, allowedDomains);
    }

    public static bool TryValidateUserInputPayload(
        string payload,
        out string? rejectReason)
    {
        rejectReason = null;

        if (payload.Length > 64 * 1024)
        {
            rejectReason = "payload too large";
            return false;
        }

        JsonDocument doc;
        try
        {
            doc = JsonDocument.Parse(payload);
        }
        catch
        {
            rejectReason = "invalid JSON payload";
            return false;
        }

        using (doc)
        {
            var root = doc.RootElement;
            if (!root.TryGetProperty("type", out var typeEl) || typeEl.ValueKind != JsonValueKind.String)
            {
                rejectReason = "missing type field";
                return false;
            }

            var type = typeEl.GetString() ?? "";
            if (!AllowedUserInputTypes.Contains(type))
            {
                rejectReason = $"blocked input type '{type}'";
                return false;
            }

            return type switch
            {
                "mousemove" or "mousedown" or "mouseup" or "wheel"
                    => TryValidatePointerLike(root, type, out rejectReason),
                "keydown" or "keyup"
                    => TryValidateKey(root, out rejectReason),
                "touch"
                    => TryValidateTouch(root, out rejectReason),
                "text"
                    => TryValidateText(root, out rejectReason),
                "goback" or "goforward"
                    => true,
                _ => false,
            };
        }
    }

    private static bool TryValidatePointerLike(JsonElement root, string type, out string? rejectReason)
    {
        rejectReason = null;
        if (!TryGetFiniteNumber(root, "x", out _) || !TryGetFiniteNumber(root, "y", out _))
        {
            rejectReason = $"{type} requires finite x/y";
            return false;
        }

        if (type is "mousedown" or "mouseup")
        {
            if (!root.TryGetProperty("button", out var btn) || btn.ValueKind != JsonValueKind.Number
                || !btn.TryGetInt32(out var button) || button is < 0 or > 2)
            {
                rejectReason = $"{type} requires button 0..2";
                return false;
            }
        }

        if (type == "wheel")
        {
            if (!TryGetFiniteNumber(root, "deltaX", out _) || !TryGetFiniteNumber(root, "deltaY", out _))
            {
                rejectReason = "wheel requires finite deltaX/deltaY";
                return false;
            }
        }

        return true;
    }

    private static bool TryValidateKey(JsonElement root, out string? rejectReason)
    {
        rejectReason = null;
        if (!root.TryGetProperty("key", out var keyEl) || keyEl.ValueKind != JsonValueKind.String)
        {
            rejectReason = "key event requires string key";
            return false;
        }

        var key = keyEl.GetString() ?? "";
        if (key.Length is 0 or > MaxKeyChars)
        {
            rejectReason = "key length out of range";
            return false;
        }

        return true;
    }

    private static bool TryValidateTouch(JsonElement root, out string? rejectReason)
    {
        rejectReason = null;
        if (!root.TryGetProperty("phase", out var phaseEl) || phaseEl.ValueKind != JsonValueKind.String)
        {
            rejectReason = "touch requires phase";
            return false;
        }

        var phase = phaseEl.GetString() ?? "";
        if (!TouchPhases.Contains(phase))
        {
            rejectReason = $"invalid touch phase '{phase}'";
            return false;
        }

        if (!root.TryGetProperty("points", out var points) || points.ValueKind != JsonValueKind.Array)
        {
            rejectReason = "touch requires points array";
            return false;
        }

        if (points.GetArrayLength() > MaxTouchPoints)
        {
            rejectReason = "too many touch points";
            return false;
        }

        if ((phase == "start" || phase == "move") && points.GetArrayLength() == 0)
        {
            rejectReason = "touch start/move requires points";
            return false;
        }

        var seenIds = new HashSet<int>();
        foreach (var p in points.EnumerateArray())
        {
            if (!p.TryGetProperty("id", out var idEl) || !idEl.TryGetInt32(out var id))
            {
                rejectReason = "touch point requires int id";
                return false;
            }

            if (!seenIds.Add(id))
            {
                rejectReason = "duplicate touch point id";
                return false;
            }

            if (!TryGetFiniteNumber(p, "x", out _) || !TryGetFiniteNumber(p, "y", out _))
            {
                rejectReason = "touch point requires finite x/y";
                return false;
            }
        }

        if (!root.TryGetProperty("changedIds", out var changed) || changed.ValueKind != JsonValueKind.Array)
        {
            rejectReason = "touch requires changedIds array";
            return false;
        }

        if (changed.GetArrayLength() is 0 or > MaxTouchPoints)
        {
            rejectReason = "changedIds length out of range";
            return false;
        }

        foreach (var c in changed.EnumerateArray())
        {
            if (c.ValueKind != JsonValueKind.Number || !c.TryGetInt32(out _))
            {
                rejectReason = "changedIds must be ints";
                return false;
            }
        }

        return true;
    }

    private static bool TryValidateText(JsonElement root, out string? rejectReason)
    {
        rejectReason = null;
        if (!root.TryGetProperty("text", out var textEl) || textEl.ValueKind != JsonValueKind.String)
        {
            rejectReason = "text requires string text";
            return false;
        }

        var text = textEl.GetString() ?? "";
        if (text.Length is 0 or > MaxTextChars)
        {
            rejectReason = "text length out of range";
            return false;
        }

        return true;
    }

    private static bool TryGetFiniteNumber(JsonElement root, string name, out double value)
    {
        value = 0;
        if (!root.TryGetProperty(name, out var el) || el.ValueKind != JsonValueKind.Number)
            return false;
        if (!el.TryGetDouble(out value) || !double.IsFinite(value))
            return false;
        if (value < MinCoord || value > MaxCoord)
            return false;
        return true;
    }
}
