using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Diff;

/// <summary>
/// Mux output stream opened (single channel of one kind, owned by a consumer).
/// </summary>
[JournalFact(
    "Telemetry.Sessions.PageProjection.Diff.OutputStreamOpened",
    schemaVersion: 1,
    Name = "PageProjection diff · output stream opened",
    Description = "LiveSession Open*Stream registered one outbound stream (frame | pageProjectionDiff | console | notification).",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class OutputStreamOpened
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    public required Guid StreamId { get; init; }

    public required Guid ConsumerId { get; init; }

    /// <summary>frame | pageProjectionDiff | console | notification</summary>
    public required string Kind { get; init; }

    public int OpenStreamCount { get; init; }

    /// <summary>Diff Wait capacity when Kind is pageProjectionDiff; otherwise 0.</summary>
    public int DiffChannelCapacity { get; init; }
}
