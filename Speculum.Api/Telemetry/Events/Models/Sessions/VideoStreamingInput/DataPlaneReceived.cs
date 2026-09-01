using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.VideoStreamingInput;

/// <summary>
/// Hop 1 when video-streaming input arrives on the framed data plane (WebTransport or WebSocket).
/// </summary>
[JournalFact(
    "Telemetry.Sessions.VideoStreamingInput.DataPlaneReceived",
    schemaVersion: 2,
    Name = "Video streaming input · data-plane received",
    Description = "VideoStreamingInput framed message was received on the Sessions data plane (product path).",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class DataPlaneReceived
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    public required string Kind { get; init; }

    public string? TraceId { get; init; }

    public long? ClientTimestampMs { get; init; }
}
