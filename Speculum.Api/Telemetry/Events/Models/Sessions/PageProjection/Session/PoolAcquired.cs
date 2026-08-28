using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Session;

[JournalFact(
    "Telemetry.Sessions.PageProjection.Session.PoolAcquired",
    schemaVersion: 1,
    Name = "PageProjection session · PoolAcquired",
    Description = "Pre-warmed browser acquired from the pool (§5.13 / §5.15).",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class PoolAcquired
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    public int MaxWidth { get; init; }

    public int MaxHeight { get; init; }

    public int PoolSize { get; init; }

    public long WaitMs { get; init; }
}
