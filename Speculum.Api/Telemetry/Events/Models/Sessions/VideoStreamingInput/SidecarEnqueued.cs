using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.VideoStreamingInput;

[JournalFact(
    "Telemetry.Sessions.VideoStreamingInput.SidecarEnqueued",
    schemaVersion: 2,
    Name = "Video streaming input · sidecar enqueued",
    Description = "Sidecar PushInput handler enqueued the event into the browser session (not applied yet).",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class SidecarEnqueued
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    public required string Kind { get; init; }

    public string? TraceId { get; init; }

    public long? ClientTimestampMs { get; init; }
}
