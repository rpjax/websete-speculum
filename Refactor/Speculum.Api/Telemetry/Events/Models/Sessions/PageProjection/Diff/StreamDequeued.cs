using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Diff;

/// <summary>
/// Diff taken from the fan-out channel by the hub Diff pump, before stream write (opt-in).
/// </summary>
[JournalFact(
    "Telemetry.Sessions.PageProjection.Diff.StreamDequeued",
    schemaVersion: 3,
    Name = "PageProjection diff · stream dequeued",
    Description = "Hub Diff pump dequeued a PageProjectionDiff from the fan-out channel before writing the data-plane stream.",
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

    /// <summary>Sidecar PageProjectionDiff timestamp (ms).</summary>
    public long Timestamp { get; init; }

    public Guid StreamId { get; init; }

    public Guid ConsumerId { get; init; }

    public long DiffEpoch { get; init; }
}
