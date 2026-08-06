using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.DomProjection.Input;

[JournalFact(
    "Telemetry.Sessions.DomProjection.Input.DataPlaneReceived",
    schemaVersion: 2,
    Name = "Dom Projection input · data-plane received",
    Description = "DomProjectionInput framed message was received on the Sessions data plane.",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class DataPlaneReceived
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    public required string Kind { get; init; }

    public long? Generation { get; init; }

    public string? Anchor { get; init; }

    public string? TraceId { get; init; }

    public long? ClientTimestampMs { get; init; }
}
