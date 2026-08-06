using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.DomProjection.Input;

[JournalFact(
    "Telemetry.Sessions.DomProjection.Input.CdpDropped",
    schemaVersion: 2,
    Name = "Dom Projection input · CDP dropped",
    Description = "Sidecar DomElementInput dropped the event before or during CDP dispatch (generation_stale, anchor_missing, invalid_coords, cdp_error, …).",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class CdpDropped
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    public required string Kind { get; init; }

    public string? Reason { get; init; }

    public long? Generation { get; init; }

    public string? Anchor { get; init; }

    public string? TraceId { get; init; }

    public long? ClientTimestampMs { get; init; }
}
