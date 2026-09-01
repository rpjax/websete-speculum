using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.Sidecar;

[JournalFact(
    "Telemetry.Sessions.Sidecar.SessionReleased",
    schemaVersion: 1,
    Name = "Sidecar session released",
    Description = "Sidecar disposed a browser session object.",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class SessionReleased
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    public string? Reason { get; init; }
}
