using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Session;

[JournalFact(
    "Telemetry.Sessions.PageProjection.Session.PoolReleased",
    schemaVersion: 1,
    Name = "PageProjection session · PoolReleased",
    Description = "Pooled browser destroyed on release (PP-SESS-2 / §5.15).",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class PoolReleased
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    public long HeldMs { get; init; }
}
