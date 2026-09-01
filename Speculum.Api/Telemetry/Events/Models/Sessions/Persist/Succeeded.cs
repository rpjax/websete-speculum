using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.Persist;

[JournalFact(
    "Telemetry.Sessions.Persist.Succeeded",
    schemaVersion: 1,
    Name = "Session persist succeeded",
    Description = "Exported session state was merged into the profile.",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class Succeeded
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }
}
