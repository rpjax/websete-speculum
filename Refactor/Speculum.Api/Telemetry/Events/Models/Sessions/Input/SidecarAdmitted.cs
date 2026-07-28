using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.Input;

[JournalFact(
    "Telemetry.Sessions.Input.SidecarAdmitted",
    schemaVersion: 1,
    Name = "Input sidecar admitted",
    Description = "Sidecar PushInput handler admitted the event into the browser session.",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class SidecarAdmitted
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    public required string Kind { get; init; }
}
