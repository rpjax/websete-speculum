namespace Speculum.Api.Maintenance.Requests;

/// <summary>Manual trigger of the same inactive-profile sweep the retention background job runs.</summary>
public sealed class DeleteInactiveProfiles
{
    /// <summary>Profiles whose LastUsedAt is older than this instant are eligible.</summary>
    public DateTimeOffset OlderThan { get; set; }

    /// <summary>Cap on how many profiles this call processes.</summary>
    public int Take { get; set; } = 100;
}
