using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.Start;

[JournalFact(
    "Telemetry.Sessions.Start.UrlResolveFailed",
    schemaVersion: 1,
    Name = "Start URL resolve failed",
    Description = "Target URL resolution failed during session start.",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class UrlResolveFailed
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    public required TelemetryJournalError[] Errors { get; init; }
}
