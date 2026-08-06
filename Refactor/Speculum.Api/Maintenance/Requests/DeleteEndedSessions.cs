namespace Speculum.Api.Maintenance.Requests;

/// <summary>Bulk cleanup of ended (Stopped/Aborted) session rows — each cascades its own Journal facts.</summary>
public sealed class DeleteEndedSessions
{
    /// <summary>Only sessions that ended before this instant; null = all ended sessions.</summary>
    public DateTimeOffset? EndedBefore { get; set; }

    /// <summary>Cap on how many sessions this call processes.</summary>
    public int Take { get; set; } = 100;
}
