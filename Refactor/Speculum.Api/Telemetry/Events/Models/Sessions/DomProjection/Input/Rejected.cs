using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.DomProjection.Input;

[JournalFact(
    "Telemetry.Sessions.DomProjection.Input.Rejected",
    schemaVersion: 2,
    Name = "Dom Projection input · rejected",
    Description = "DomProjectionInput was rejected before or while pushing to the sidecar.",
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

    public long? Generation { get; init; }

    public string? Anchor { get; init; }

    public string? TraceId { get; init; }

    public long? ClientTimestampMs { get; init; }
}
