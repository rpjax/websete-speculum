using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Frame;

[JournalFact(
    "Telemetry.Sessions.PageProjection.Frame.Aggregate",
    schemaVersion: 1,
    Name = "PageProjection frame · Aggregate",
    Description = "Periodic frame-plane aggregate (§5.15 aggregateIntervalMs).",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class Aggregate
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    public string PageEpochId { get; init; } = "";

    public long Generation { get; init; }

    public long FramesEmitted { get; init; }

    public long BytesEmitted { get; init; }

    public long RateHz { get; init; }

    public long StallCount { get; init; }

    public long ApplyOverrunReports { get; init; }

    public long MirrorBytes { get; init; }

    public long IntervalMs { get; init; }

    public long TVirtualMs { get; init; }
}
