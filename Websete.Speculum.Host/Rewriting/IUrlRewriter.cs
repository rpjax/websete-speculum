namespace Websete.Speculum.Host.Rewriting;

/// <summary>
/// Rewrites URLs by applying the forwarding profile rules from
/// <see cref="Config.SpeculumConfig"/> in the order they are declared.
///
/// Profile matching is done on the request host; rules perform regex
/// substitutions on the full URL string, preserving path, query string,
/// and fragment unchanged.
/// </summary>
public interface IUrlRewriter
{
    /// <summary>
    /// Finds the forwarding profile whose domain matches <paramref name="requestHost"/>
    /// and applies its rules — in declaration order — to <paramref name="url"/>.
    /// </summary>
    /// <param name="url">
    /// The original URL (e.g. <c>https://www.websete.localhost/cars?q=1</c>).
    /// </param>
    /// <param name="requestHost">
    /// The host from the incoming HTTP request (no port, e.g. <c>www.websete.localhost</c>).
    /// Used only for profile selection; it does <b>not</b> appear in the output.
    /// </param>
    /// <returns>
    /// The rewritten URL, or <c>null</c> when no profile matched
    /// <paramref name="requestHost"/>.
    /// </returns>
    string? Rewrite(string url, string requestHost);
}
