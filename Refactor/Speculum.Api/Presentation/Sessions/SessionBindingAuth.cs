using System.Diagnostics.CodeAnalysis;
using Microsoft.AspNetCore.Http;
using Speculum.Api.Sessions.Services.Contracts;

namespace Speculum.Api.Presentation.Sessions;

/// <summary>
/// Live-session binding auth for HTTP edges (virtual assets, data-plane dial).
/// <para>
/// The binding token travels in a <b>reserved</b> query parameter
/// (<see cref="QueryParameterName"/>). A mirrored site's own <c>token=</c> is
/// opaque upstream query: it is never read as Speculum auth. There is no session
/// binding cookie — operator auth cookies are unrelated.
/// </para>
/// Pure string helpers so the collision rules are unit-testable without HTTP plumbing.
/// </summary>
public static class SessionBindingAuth
{
    /// <summary>
    /// Reserved auth parameter. Must match the web client's
    /// <c>SessionAuthQueryParam</c>.
    /// </summary>
    public const string QueryParameterName = "speculum-session-token";

    /// <summary>
    /// Reserved client-side cache buster for forced stylesheet reloads. Must match
    /// the web client's <c>SessionCacheBustQueryParam</c>.
    /// </summary>
    public const string CacheBustQueryParameterName = "speculum-cache-bust";

    /// <summary>
    /// Internal escape hatch for cross-origin dev and harness callers. Not a product path.
    /// </summary>
    public const string HeaderName = "X-Speculum-Session-Token";

    private static readonly string[] ReservedParameterNames =
    [
        QueryParameterName,
        CacheBustQueryParameterName,
    ];

    /// <summary>
    /// Picks the session token from the reserved query parameter, falling back to the
    /// header. Returns <c>null</c> when neither carries a usable value.
    /// </summary>
    public static string? SelectToken(string? reservedQueryValue, string? headerValue)
    {
        if (!string.IsNullOrWhiteSpace(reservedQueryValue))
        {
            return reservedQueryValue.Trim();
        }

        return string.IsNullOrWhiteSpace(headerValue) ? null : headerValue.Trim();
    }

    /// <summary>
    /// Reads the binding token from the reserved query parameter, then the header.
    /// </summary>
    public static string? ReadToken(HttpRequest request)
        => SelectToken(
            request.Query[QueryParameterName].ToString(),
            request.Headers[HeaderName].ToString());

    /// <summary>
    /// Resolves a live session from the request binding token.
    /// When <paramref name="expectedSessionId"/> is set, the binding must match that id
    /// (carriers that require <c>sessionId</c> in the query). Otherwise token-only lookup
    /// is used (virtual-asset edges).
    /// </summary>
    public static bool TryAuthorize(
        HttpRequest request,
        ISessionBindingRegistry bindings,
        ILiveSessionService liveSessions,
        [NotNullWhen(true)] out ILiveSession? live,
        [NotNullWhen(true)] out string? token,
        Guid? expectedSessionId = null)
    {
        live = null;
        token = ReadToken(request);
        if (token is null)
        {
            return false;
        }

        if (expectedSessionId is Guid sessionId)
        {
            if (!bindings.TryGetLive(sessionId, token, out _)
                || !liveSessions.TryGet(sessionId, out live))
            {
                live = null;
                return false;
            }

            return true;
        }

        if (!bindings.TryGetLiveByToken(token, out var binding)
            || !liveSessions.TryGet(binding.SessionId, out live))
        {
            live = null;
            return false;
        }

        return true;
    }

    /// <summary>
    /// Removes only Speculum-reserved parameters from a raw query string, preserving
    /// every remaining part verbatim (order, encoding, duplicate names) so the result
    /// matches the key the producer materialized the asset under.
    /// </summary>
    public static string StripReservedFromQuery(string query)
    {
        if (string.IsNullOrEmpty(query) || query == "?")
        {
            return "";
        }

        var raw = query.StartsWith('?') ? query[1..] : query;
        var kept = raw
            .Split('&', StringSplitOptions.RemoveEmptyEntries)
            .Where(part => !IsReserved(part))
            .ToArray();

        return kept.Length == 0 ? "" : "?" + string.Join('&', kept);
    }

    /// <summary>
    /// Replace-or-append a reserved query parameter without normalizing encoding/order
    /// of other params (matches client <c>appendSessionAuth</c>).
    /// </summary>
    public static string SetReservedParam(string url, string name, string value)
    {
        ArgumentNullException.ThrowIfNull(url);
        ArgumentNullException.ThrowIfNull(name);
        ArgumentNullException.ThrowIfNull(value);

        var hashAt = url.IndexOf('#');
        var fragment = hashAt >= 0 ? url[hashAt..] : "";
        var withoutFragment = hashAt >= 0 ? url[..hashAt] : url;

        var queryAt = withoutFragment.IndexOf('?');
        var path = queryAt >= 0 ? withoutFragment[..queryAt] : withoutFragment;
        var rawQuery = queryAt >= 0 ? withoutFragment[(queryAt + 1)..] : "";

        var kept = rawQuery
            .Split('&', StringSplitOptions.RemoveEmptyEntries)
            .Where(part =>
            {
                var eq = part.IndexOf('=');
                var key = eq >= 0 ? part[..eq] : part;
                return !key.Equals(name, StringComparison.OrdinalIgnoreCase);
            })
            .ToList();

        kept.Add($"{name}={Uri.EscapeDataString(value)}");
        return $"{path}?{string.Join('&', kept)}{fragment}";
    }

    private static bool IsReserved(string queryPart)
    {
        var eq = queryPart.IndexOf('=');
        var name = eq >= 0 ? queryPart[..eq] : queryPart;
        foreach (var reserved in ReservedParameterNames)
        {
            if (name.Equals(reserved, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }

        return false;
    }
}
