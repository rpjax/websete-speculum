using System.Text.RegularExpressions;

namespace Speculum.Api.Virtualization;

public static partial class SessionIdNormalizer
{
    [GeneratedRegex("^[a-f0-9]{32}$", RegexOptions.Compiled)]
    private static partial Regex ValidSessionIdRegex();

    public static string Resolve(string? sessionId)
    {
        if (string.IsNullOrWhiteSpace(sessionId))
            return Guid.NewGuid().ToString("N");

        var trimmed = sessionId.Trim();
        if (!ValidSessionIdRegex().IsMatch(trimmed))
            throw new ArgumentException("sessionId must be a 32-character lowercase hex string.", nameof(sessionId));

        return trimmed;
    }
}
