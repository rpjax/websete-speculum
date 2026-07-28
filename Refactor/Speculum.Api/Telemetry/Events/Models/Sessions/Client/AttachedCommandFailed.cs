using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.Client;

[JournalFact(
    "Telemetry.Sessions.Client.AttachedCommandFailed",
    schemaVersion: 1,
    Name = "Attached client command failed",
    Description = "Pushing a command to the attached browser client failed.",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class AttachedCommandFailed
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    public required string Command { get; init; }

    public required TelemetryJournalError[] Errors { get; init; }
}
