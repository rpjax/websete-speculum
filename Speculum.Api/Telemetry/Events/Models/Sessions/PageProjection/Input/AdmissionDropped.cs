using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Input;

[JournalFact(
    "Telemetry.Sessions.PageProjection.Input.AdmissionDropped",
    schemaVersion: 2,
    Name = "Dom Projection input · admission dropped",
    Description = "PageProjectionIntent was evicted from the API admission queue (DropOldest) before PushDomInput.",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class AdmissionDropped
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
