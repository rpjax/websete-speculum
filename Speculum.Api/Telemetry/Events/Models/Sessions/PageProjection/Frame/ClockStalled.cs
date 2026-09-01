using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Frame;

[JournalFact(
    "Telemetry.Sessions.PageProjection.Frame.ClockStalled",
    schemaVersion: 1,
    Name = "PageProjection frame · ClockStalled",
    Description = "Frame clock watchdog fired (§5.3.4.4 / §5.15).",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class ClockStalled
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    public string PageEpochId { get; init; } = "";

    public long SinceLastTickMs { get; init; }

    public long Generation { get; init; }
}
