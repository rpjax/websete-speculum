using Speculum.Wire;

namespace Speculum.Supervisor;

/// <summary>
/// Phase 10 A6 — schema hash must match across the three generated tips.
/// Divergence is a hard deploy error (code + expected/got), never a warning.
/// </summary>
public static class SchemaIdentity
{
    public const string DeployMismatchCode = "schema_hash_mismatch";

    public static string EmbeddedSha256 => SchemaMeta.Sha256;

    /// <summary>
    /// Compare embedded tip to an expected value (env or peer tip). Throws on mismatch.
    /// </summary>
    public static void AssertMatches(string expected, string origin)
    {
        if (string.IsNullOrEmpty(expected))
        {
            throw new InvalidOperationException(
                $"{DeployMismatchCode}: empty expected hash ({origin})");
        }

        if (!string.Equals(expected, SchemaMeta.Sha256, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException(
                $"{DeployMismatchCode}: origin={origin} expected={expected} got={SchemaMeta.Sha256}");
        }
    }

    /// <summary>
    /// Boot check: if SPECULUM_SCHEMA_SHA256 is set, it must match the embedded tip.
    /// Always returns the embedded hash for logging.
    /// </summary>
    public static string AssertDeployOrThrow()
    {
        var expected = Environment.GetEnvironmentVariable("SPECULUM_SCHEMA_SHA256");
        if (!string.IsNullOrEmpty(expected))
        {
            AssertMatches(expected, "SPECULUM_SCHEMA_SHA256");
        }

        return SchemaMeta.Sha256;
    }
}
