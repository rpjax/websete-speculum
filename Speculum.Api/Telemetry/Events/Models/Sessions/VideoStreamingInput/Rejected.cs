using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.VideoStreamingInput;

[JournalFact(
    "Telemetry.Sessions.VideoStreamingInput.Rejected",
    schemaVersion: 2,
    Name = "Video streaming input · rejected",
    Description = "VideoStreamingInput was rejected before or while pushing to the sidecar.",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class Rejected
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    public string? ErrorCode { get; init; }

    public string? Message { get; init; }

    [JournalIndex("phase")]
    public string? Phase { get; init; }

    public string? TraceId { get; init; }

    public long? ClientTimestampMs { get; init; }
}
