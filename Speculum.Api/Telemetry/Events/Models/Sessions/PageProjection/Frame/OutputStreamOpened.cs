using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Frame;

/// <summary>
/// Mux output stream opened (single channel of one kind, owned by a consumer).
/// </summary>
[JournalFact(
    "Telemetry.Sessions.PageProjection.Frame.OutputStreamOpened",
    schemaVersion: 1,
    Name = "PageProjection frame · output stream opened",
    Description = "LiveSession Open*Stream registered one outbound stream (frame | pageProjectionFrame | console | notification).",
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

    /// <summary>frame | pageProjectionFrame | console | notification</summary>
    public required string Kind { get; init; }

    public int OpenStreamCount { get; init; }

    /// <summary>frame Wait capacity when Kind is pageProjectionFrame; otherwise 0.</summary>
    public int FrameChannelCapacity { get; init; }
}
