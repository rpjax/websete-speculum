using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.Persist;

[JournalFact(
    "Telemetry.Sessions.Persist.SkippedNoConnection",
    schemaVersion: 1,
    Name = "Persist skipped (no connection)",
    Description = "State export skipped because the sidecar connection was already gone.",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class SkippedNoConnection
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

}
