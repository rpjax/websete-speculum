namespace Speculum.Api.Sessions.Models;

/// <summary>
/// Sidecar cookie sanitize + CDP apply counts from profile-state restore.
/// </summary>
public sealed class CookieNormalizeStats
{
    public int Total { get; init; }
    public int Skipped { get; init; }
    public int Normalized { get; init; }
    public int Applied { get; init; }
    public int FailedIndividual { get; init; }

    public static CookieNormalizeStats Empty { get; } = new();
}
