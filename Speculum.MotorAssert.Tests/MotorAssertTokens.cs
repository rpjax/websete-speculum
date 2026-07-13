namespace Speculum.MotorAssert.Tests;

/// <summary>
/// <c>ClientTokenNormalizer</c> exige exactamente 32 hex lowercase.
/// </summary>
internal static class MotorAssertTokens
{
    public static string New() => Guid.NewGuid().ToString("N");

    /// <summary>Token determinístico (persistência E1/E2) a partir de um rótulo.</summary>
    public static string Fixed(string label)
    {
        var hash = System.Security.Cryptography.SHA256.HashData(
            System.Text.Encoding.UTF8.GetBytes(label));
        return Convert.ToHexString(hash.AsSpan(0, 16)).ToLowerInvariant();
    }
}
