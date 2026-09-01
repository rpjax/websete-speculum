using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Frame;

/// <summary>
/// Sequenced frame drop — client will observe a sequence gap / desync.
/// </summary>
[JournalFact(
    "Telemetry.Sessions.PageProjection.Frame.QueueDropped",
    schemaVersion: 3,
    Name = "PageProjection frame · queue dropped",
    Description = "PageProjection frame(s) dropped (DropAll / gRPC congestion / mapper reject).",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class QueueDropped
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    /// <summary>
    /// api_sequenced | api_fanout_no_target | api_fanout_pipe_closed | api_fanout_backpressure |
    /// api_wire_stall | sidecar_bridge |
    /// sidecar_requeue_overflow | sidecar_grpc_inflight | sidecar_lifecycle_overflow |
    /// sidecar_bridge_closed | mapper_rejected
    /// </summary>
    public required string Stage { get; init; }

    public int DroppedCount { get; init; }

    public int Capacity { get; init; }

    public long? Sequence { get; init; }

    public long? Generation { get; init; }

    public string? Plane { get; init; }

    public string? Operation { get; init; }

    public long? LowestDroppedSequence { get; init; }

    public long? HighestDroppedSequence { get; init; }

    public string? Reason { get; init; }

    public Guid? StreamId { get; init; }

    public Guid? ConsumerId { get; init; }

    /// <summary>frame | pageProjectionFrame | console | notification</summary>
    public string? Kind { get; init; }

    public int? TargetCount { get; init; }

    public int? FrameChannelCount { get; init; }

    public long? FrameEpoch { get; init; }
}
