using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.Capacity;

[JournalFact(
    "Telemetry.Sessions.Capacity.SlotAcquired",
    schemaVersion: 1,
    Name = "Slot acquired",
    Description = "A live session slot was reserved (capacity telemetry).",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class SlotAcquired
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

}
