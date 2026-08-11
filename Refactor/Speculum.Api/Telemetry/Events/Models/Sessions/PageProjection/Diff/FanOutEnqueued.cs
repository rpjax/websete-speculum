using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Diff;

/// <summary>
/// Diff accepted into an open Diff fan-out channel toward the client Diff pump (opt-in).
/// </summary>
[JournalFact(
    "Telemetry.Sessions.PageProjection.Diff.FanOutEnqueued",
    schemaVersion: 3,
    Name = "PageProjection diff · fan-out enqueued",
    Description = "API wrote a PageProjectionDiff into an open Diff Wait channel (after any Wait), with stream/consumer identity.",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class FanOutEnqueued
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

    /// <summary>Milliseconds blocked on fan-out <c>WriteAsync</c> (0 if immediate).</summary>
    public long WaitMs { get; init; }

    public Guid StreamId { get; init; }

    public Guid ConsumerId { get; init; }

    /// <summary>frame | pageProjectionDiff | console | notification</summary>
    public required string Kind { get; init; }

    public int TargetIndex { get; init; }

    public int TargetCount { get; init; }

    /// <summary>Items in the Diff channel after write when countable; otherwise -1.</summary>
    public int DiffChannelCount { get; init; }

    public long DiffEpoch { get; init; }
}
