using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.Persist;

[JournalFact(
    "Telemetry.Sessions.Persist.SkippedProfileNotFound",
    schemaVersion: 1,
    Name = "Persist skipped (profile missing)",
    Description = "State export skipped because the profile row was missing.",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class SkippedProfileNotFound
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

}
