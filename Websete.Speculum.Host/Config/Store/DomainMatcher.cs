namespace Websete.Speculum.Host.Config.Store;

public static class DomainMatcher
{
    /// <summary>
    /// Returns true when <paramref name="host"/> matches <paramref name="pattern"/>.
    /// Wildcard patterns use the form <c>*.example.com</c> (does not match apex).
    /// </summary>
    public static bool Matches(string host, string pattern)
    {
        if (string.IsNullOrWhiteSpace(host) || string.IsNullOrWhiteSpace(pattern))
            return false;

        host    = host.Trim();
        pattern = pattern.Trim();

        if (pattern.StartsWith("*.", StringComparison.Ordinal))
        {
            var suffix = pattern[2..];
            return host.EndsWith('.' + suffix, StringComparison.OrdinalIgnoreCase);
        }

        return host.Equals(pattern, StringComparison.OrdinalIgnoreCase);
    }

    public static bool MatchesAny(string host, IEnumerable<string> patterns)
        => patterns.Any(p => Matches(host, p));
}
