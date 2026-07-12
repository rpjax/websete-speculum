using System.Text.RegularExpressions;

namespace Speculum.Api.Virtualization;

public static partial class ClientTokenNormalizer
{
    [GeneratedRegex("^[a-f0-9]{32}$", RegexOptions.Compiled)]
    private static partial Regex ValidClientTokenRegex();

    public static string Resolve(string? clientToken)
    {
        if (string.IsNullOrWhiteSpace(clientToken))
            return Guid.NewGuid().ToString("N");

        var trimmed = clientToken.Trim();
        if (!ValidClientTokenRegex().IsMatch(trimmed))
            throw new ArgumentException("clientToken must be a 32-character lowercase hex string.", nameof(clientToken));

        return trimmed;
    }
}
