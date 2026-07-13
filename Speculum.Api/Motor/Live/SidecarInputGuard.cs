using System.Text.Json;
using Speculum.Api.Config.Store;

namespace Speculum.Api.Motor.Live;

/// <summary>
/// Validates commands relayed from hub clients to the sidecar.
/// </summary>
internal static class SidecarInputGuard
{
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
        }

        return true;
    }
}
