using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.VideoStreamingInput;

/// <summary>
/// Hop 1 when video-streaming input arrives on the control plane (harness/admin), not the product data plane.
/// </summary>
[JournalFact(
    "Telemetry.Sessions.VideoStreamingInput.ControlReceived",
    schemaVersion: 2,
    Name = "Video streaming input · control received",
    Description = "VideoStreamingInput was admitted on the SignalR/control plane (harness path).",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class ControlReceived
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    public required string Kind { get; init; }

    public string? TraceId { get; init; }

    public long? ClientTimestampMs { get; init; }
}
