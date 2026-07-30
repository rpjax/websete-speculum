using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.Sidecar;

[JournalFact(
    "Telemetry.Sessions.Sidecar.SessionAllocated",
    schemaVersion: 1,
    Name = "Sidecar session allocated",
    Description = "Sidecar registered a new browser session object.",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class SessionAllocated
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    public string? InputBackend { get; init; }
}
