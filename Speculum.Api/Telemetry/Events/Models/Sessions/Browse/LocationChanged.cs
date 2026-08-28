using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.Browse;

[JournalFact(
    "Telemetry.Sessions.Browse.LocationChanged",
    schemaVersion: 1,
    Name = "Location changed",
    Description = "Browser main-frame location changed (high churn telemetry).",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class LocationChanged
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    public required string Url { get; init; }
}
