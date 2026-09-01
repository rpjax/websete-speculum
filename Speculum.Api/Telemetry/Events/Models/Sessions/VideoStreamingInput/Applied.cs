using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.VideoStreamingInput;

[JournalFact(
    "Telemetry.Sessions.VideoStreamingInput.Applied",
    schemaVersion: 2,
    Name = "Video streaming input · applied",
    Description = "VideoStreamingInput was accepted and pushed toward the sidecar.",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class Applied
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    public required string Kind { get; init; }

    public string? Phase { get; init; }

    public string? TraceId { get; init; }

    public long? ClientTimestampMs { get; init; }
}
