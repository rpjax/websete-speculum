using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.Capacity;

[JournalFact(
    "Telemetry.Sessions.Capacity.NoSlotAvailable",
    schemaVersion: 1,
    Name = "No slot available",
    Description = "Start rejected because no live session slot was available.",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class NoSlotAvailable
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

}
