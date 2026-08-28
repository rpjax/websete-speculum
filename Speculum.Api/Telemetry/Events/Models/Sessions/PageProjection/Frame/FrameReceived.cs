using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Frame;

/// <summary>
/// PageProjectionFrame frame received from sidecar WatchPageProjectionFrames (hot path — opt-in).
/// </summary>
[JournalFact(
    "Telemetry.Sessions.PageProjection.Frame.FrameReceived",
    schemaVersion: 5,
    Name = "PageProjection frame · frame received",
    Description = "API received a PageProjectionFrame frame from the sidecar WatchPageProjectionFrames stream.",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class FrameReceived
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    /// <summary>dom | cssom</summary>
    public required string Plane { get; init; }

    /// <summary>Dom or Cssom operation name.</summary>
    public required string Operation { get; init; }

    public long Sequence { get; init; }

    public long Generation { get; init; }

    /// <summary>Sidecar PageProjectionFrame timestamp (ms).</summary>
    public long Timestamp { get; init; }

    /// <summary>Cssom install / sheetList sheet count when present.</summary>
    public int? SheetCount { get; init; }

    /// <summary>Total rules across sheets when present.</summary>
    public int? RuleCount { get; init; }

    /// <summary>Sheets whose rule ids use the C6.5 <c>seed:</c> prefix.</summary>
    public int? SeededSheetCount { get; init; }
}
