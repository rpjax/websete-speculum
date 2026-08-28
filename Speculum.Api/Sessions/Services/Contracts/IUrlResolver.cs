using Aidan.Core.Patterns;

namespace Speculum.Api.Sessions.Services.Contracts;

/// <summary>
/// Maps client path/query ↔ absolute browser URL for start, navigate, and SyncUrl.
/// Hosting / Navigation / NSO / subdomain mirroring are resolved inside the implementation.
/// </summary>
public interface IUrlResolver
{
    /// <summary>
    /// Builds the target URL for the client path and query from the hub.
    /// </summary>
    /// <param name="path">
    /// Client pathname only (e.g. <c>/search</c> or <c>/nav/b</c>). No query string.
    /// </param>
    /// <param name="query">
    /// Client query string without leading <c>?</c> (e.g. <c>q=1&amp;_w7s_nso=…</c>),
    /// or empty when there is no query.
    /// </param>
    /// <returns>
    /// Absolute target URL on success; failure when the input is malformed or blocked
    /// (allowlist / mapping) before a target can be built.
    /// </returns>
    IResult<string> Resolve(string path, string query, string requestHost);

    /// <summary>
    /// Maps an absolute browser target URL back to a session-host SyncUrl
    /// (apex + <c>_w7s_nso</c>, or mirrored host remap).
    /// </summary>
    /// <param name="targetUrl">Absolute http(s) URL from the sidecar location notification.</param>
    /// <param name="requestHost">Session transport host (same as start/navigate).</param>
    IResult<string> ProjectToClient(string targetUrl, string requestHost);
}
