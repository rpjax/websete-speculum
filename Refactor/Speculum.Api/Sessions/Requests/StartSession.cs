using Speculum.Api.Sessions.Models;

namespace Speculum.Api.Sessions.Requests;

public sealed class StartSession
{
    public Guid ProfileId { get; set; }

    /// <summary>
    /// Client pathname from the hub (e.g. <c>/search</c>). No query string.
    /// </summary>
    public string Path { get; set; } = string.Empty;

    /// <summary>
    /// Client query string without leading <c>?</c> (e.g. <c>q=1&amp;_w7s_nso=…</c>),
    /// or empty when absent.
    /// </summary>
    public string Query { get; set; } = string.Empty;

    public SessionConfig? Configuration { get; set; }
}
