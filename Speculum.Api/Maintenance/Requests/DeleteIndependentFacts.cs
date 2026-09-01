namespace Speculum.Api.Maintenance.Requests;

/// <summary>
/// Cleanup of Journal facts that carry no <c>session</c> index key. Facts tied to a session
/// can never be targeted through this request — see <see cref="Services.Contracts.IMaintenanceService"/>.
/// </summary>
public sealed class DeleteIndependentFacts
{
    /// <summary>Narrow to one fact type; null = all independent fact types.</summary>
    public string? Type { get; set; }

    /// <summary>Only facts published before this instant; null = no age bound.</summary>
    public DateTimeOffset? OlderThan { get; set; }
}
