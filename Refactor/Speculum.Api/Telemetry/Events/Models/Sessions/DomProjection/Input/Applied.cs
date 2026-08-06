using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.DomProjection.Input;

[JournalFact(
    "Telemetry.Sessions.DomProjection.Input.Applied",
    schemaVersion: 2,
    Name = "Dom Projection input · applied",
    Description = "DomProjectionInput was accepted on the API→sidecar PushDomInput write (gRPC push), not CDP dispatch.",
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

    public long? Generation { get; init; }

    public string? Anchor { get; init; }

    public string? TraceId { get; init; }

    public long? ClientTimestampMs { get; init; }
}
