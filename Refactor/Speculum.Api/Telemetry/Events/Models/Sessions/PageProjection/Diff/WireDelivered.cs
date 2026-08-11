using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Diff;

/// <summary>
/// Diff envelope written onto the Sessions data-plane toward the client (opt-in).
/// </summary>
[JournalFact(
    "Telemetry.Sessions.PageProjection.Diff.WireDelivered",
    schemaVersion: 4,
    Name = "PageProjection diff · wire delivered",
    Description = "API wrote a PageProjectionDiff frame to the client data-plane output stream.",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class WireDelivered
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

    /// <summary>Milliseconds spent in data-plane <c>WriteMessageAsync</c> for this frame.</summary>
    public long DurationMs { get; init; }

    public Guid StreamId { get; init; }

    public Guid ConsumerId { get; init; }

    public long DiffEpoch { get; init; }
}
