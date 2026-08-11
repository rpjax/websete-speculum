namespace Speculum.Api.Maintenance.Responses;

/// <summary>Outcome of a Maintenance deletion action — zero fields are populated when not applicable.</summary>
public sealed class MaintenanceDeletionResult
{
    public int SessionsDeleted { get; init; }
    public int JournalFactsDeleted { get; init; }
    public int ProfilesDeleted { get; init; }
    public int ResourceSignalsDeleted { get; init; }
    public int ResourceReportsDeleted { get; init; }
    public bool VacuumRan { get; init; }
}
