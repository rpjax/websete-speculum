using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.DomProjection.Diff;

/// <summary>
/// DomDiff frame received from sidecar WatchDom (hot path — opt-in).
/// </summary>
[JournalFact(
    "Telemetry.Sessions.DomProjection.Diff.FrameReceived",
    schemaVersion: 3,
    Name = "Dom Projection diff · frame received",
    Description = "API received a DomDiff frame from the sidecar WatchDom stream.",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class FrameReceived
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    /// <summary>diff | cssom</summary>
    public required string Kind { get; init; }

    /// <summary>document | anchors when Kind is diff.</summary>
    public string? Target { get; init; }

    /// <summary>dom | cssom</summary>
    public string? TreeType { get; init; }

    public long Sequence { get; init; }

    public long Generation { get; init; }

    /// <summary>Sidecar DomDiff timestamp (ms).</summary>
    public long Timestamp { get; init; }

    public int? NodeCount { get; init; }

    public int? UrlCount { get; init; }
}
