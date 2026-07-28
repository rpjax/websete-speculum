using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.Input;

[JournalFact(
    "Telemetry.Sessions.Input.SidecarPushWritten",
    schemaVersion: 1,
    Name = "Input sidecar push written",
    Description = "User input was written on the API to sidecar PushInput client stream.",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class SidecarPushWritten
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    public required string Kind { get; init; }

    public string? Phase { get; init; }
}
