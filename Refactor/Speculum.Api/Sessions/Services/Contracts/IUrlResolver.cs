using Aidan.Core.Patterns;

namespace Speculum.Api.Sessions.Services.Contracts;

/// <summary>
/// Maps a client navigation path to the absolute target URL for sidecar <c>Navigate</c>.
/// Same port for session start and runtime navigate.
/// Hosting / Forwarding / NSO / subdomain mirroring are resolved inside the implementation.
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
    IResult<string> Resolve(string path, string query);
}
