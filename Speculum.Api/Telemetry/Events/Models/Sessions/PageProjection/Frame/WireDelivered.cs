using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Frame;

/// <summary>
/// Frame envelope written onto the Sessions data-plane toward the client (opt-in).
/// </summary>
[JournalFact(
    "Telemetry.Sessions.PageProjection.Frame.WireDelivered",
    schemaVersion: 4,
    Name = "PageProjection frame · wire delivered",
    Description = "API wrote a PageProjectionFrame frame to the client data-plane output stream.",
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

    /// <summary>Sidecar PageProjectionFrame timestamp (ms).</summary>
    public long Timestamp { get; init; }

    /// <summary>Milliseconds spent in data-plane <c>WriteMessageAsync</c> for this frame.</summary>
    public long DurationMs { get; init; }

    public Guid StreamId { get; init; }

    public Guid ConsumerId { get; init; }

    public long FrameEpoch { get; init; }
}
