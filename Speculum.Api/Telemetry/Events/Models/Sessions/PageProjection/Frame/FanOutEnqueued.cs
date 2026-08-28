using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Frame;

/// <summary>
/// Frame accepted into an open frame fan-out channel toward the client frame pump (opt-in).
/// </summary>
[JournalFact(
    "Telemetry.Sessions.PageProjection.Frame.FanOutEnqueued",
    schemaVersion: 3,
    Name = "PageProjection frame · fan-out enqueued",
    Description = "API wrote a PageProjectionFrame into an open frame Wait channel (after any Wait), with stream/consumer identity.",
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

    /// <summary>Sidecar PageProjectionFrame timestamp (ms).</summary>
    public long Timestamp { get; init; }

    /// <summary>Milliseconds blocked on fan-out <c>WriteAsync</c> (0 if immediate).</summary>
    public long WaitMs { get; init; }

    public Guid StreamId { get; init; }

    public Guid ConsumerId { get; init; }

    /// <summary>frame | pageProjectionFrame | console | notification</summary>
    public required string Kind { get; init; }

    public int TargetIndex { get; init; }

    public int TargetCount { get; init; }

    /// <summary>Items in the frame channel after write when countable; otherwise -1.</summary>
    public int FrameChannelCount { get; init; }

    public long FrameEpoch { get; init; }
}
