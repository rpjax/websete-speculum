namespace Speculum.Api.Maintenance.Responses;

/// <summary>Cleanup-candidate counts for the front-end Maintenance page to show before acting.</summary>
public sealed class MaintenanceSummary
{
    public int EndedSessionsCount { get; init; }
    public int LiveSessionsCount { get; init; }
    public int IndependentJournalFactsCount { get; init; }
    public int InactiveProfilesCount { get; init; }
}
