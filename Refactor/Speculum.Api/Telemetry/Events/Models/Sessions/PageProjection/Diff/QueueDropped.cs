using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Diff;

/// <summary>
/// Sequenced Diff drop — client will observe a sequence gap / desync.
/// </summary>
[JournalFact(
    "Telemetry.Sessions.PageProjection.Diff.QueueDropped",
    schemaVersion: 1,
    Name = "PageProjection diff · queue dropped",
    Description = "PageProjection Diff frame(s) dropped (DropAll / gRPC congestion / mapper reject).",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class QueueDropped
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    /// <summary>
    /// api_sequenced | api_fanout_no_target | api_fanout_pipe_closed | sidecar_bridge |
    /// sidecar_requeue_overflow | sidecar_grpc_inflight | sidecar_lifecycle_overflow |
    /// sidecar_bridge_closed | mapper_rejected
    /// </summary>
    public required string Stage { get; init; }

    public int DroppedCount { get; init; }

    public int Capacity { get; init; }

    /// <summary>Surviving / kept envelope sequence (DropAll write that triggered drain).</summary>
    public long? Sequence { get; init; }

    public long? Generation { get; init; }

    public string? Plane { get; init; }

    public string? Operation { get; init; }

    /// <summary>Lowest sequence among drained/dropped frames (when known).</summary>
    public long? LowestDroppedSequence { get; init; }

    /// <summary>Highest sequence among drained/dropped frames (when known).</summary>
    public long? HighestDroppedSequence { get; init; }

    /// <summary>Optional reject/drop detail (e.g. mapper reason).</summary>
    public string? Reason { get; init; }
}
