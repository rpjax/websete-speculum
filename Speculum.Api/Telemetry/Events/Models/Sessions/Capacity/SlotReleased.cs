using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.Capacity;

[JournalFact(
    "Telemetry.Sessions.Capacity.SlotReleased",
    schemaVersion: 1,
    Name = "Slot released",
    Description = "A live session slot was released (capacity telemetry).",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class SlotReleased
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

}
