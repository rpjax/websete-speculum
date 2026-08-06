using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.DomProjection.Input;

[JournalFact(
    "Telemetry.Sessions.DomProjection.Input.SidecarPushWritten",
    schemaVersion: 2,
    Name = "Dom Projection input · sidecar push written",
    Description = "DomProjectionInput was written on the API→sidecar PushDomInput client stream.",
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

    public long? Generation { get; init; }

    public string? Anchor { get; init; }

    public string? TraceId { get; init; }

    public long? ClientTimestampMs { get; init; }
}
