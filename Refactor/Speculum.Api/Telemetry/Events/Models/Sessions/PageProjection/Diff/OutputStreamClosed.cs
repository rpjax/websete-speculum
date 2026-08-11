using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Diff;

/// <summary>
/// Mux output stream closed (stream dispose / multiplexer teardown).
/// </summary>
[JournalFact(
    "Telemetry.Sessions.PageProjection.Diff.OutputStreamClosed",
    schemaVersion: 1,
    Name = "PageProjection diff · output stream closed",
    Description = "LiveSession stream dispose unregistered one outbound stream.",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class OutputStreamClosed
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
}
