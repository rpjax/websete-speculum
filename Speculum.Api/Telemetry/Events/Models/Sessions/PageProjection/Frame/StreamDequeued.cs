using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Frame;

/// <summary>
/// Frame taken from the fan-out channel by the hub frame pump, before stream write (opt-in).
/// </summary>
[JournalFact(
    "Telemetry.Sessions.PageProjection.Frame.StreamDequeued",
    schemaVersion: 3,
    Name = "PageProjection frame · stream dequeued",
    Description = "Hub frame pump dequeued a PageProjectionFrame from the fan-out channel before writing the data-plane stream.",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class StreamDequeued
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    /// <summary>dom | cssom</summary>
    public required string Plane { get; init; }

    public required string Operation { get; init; }

    public long Sequence { get; init; }

    public long Generation { get; init; }

    /// <summary>Sidecar PageProjectionFrame timestamp (ms).</summary>
    public long Timestamp { get; init; }

    public Guid StreamId { get; init; }

    public Guid ConsumerId { get; init; }

    public long FrameEpoch { get; init; }
}
