using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.VideoStreamingInput;

[JournalFact(
    "Telemetry.Sessions.VideoStreamingInput.SidecarAdmitted",
    schemaVersion: 2,
    Name = "Video streaming input · sidecar admitted",
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

    public string? TraceId { get; init; }

    public long? ClientTimestampMs { get; init; }
}
