using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Diff;

/// <summary>
/// Same-document soft navigation observed (D4) — observe-only; does not remount Dom.
/// </summary>
[JournalFact(
    "Telemetry.Sessions.PageProjection.Diff.SoftNavObserved",
    schemaVersion: 1,
    Name = "PageProjection diff · soft nav observed",
    Description = "Main-frame navigatedWithinDocument / same documentEpoch soft nav (no generation bump).",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class SoftNavObserved
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    public long Generation { get; init; }

    public string? Url { get; init; }

    public string? DocumentEpoch { get; init; }

    public bool LiveArmed { get; init; }
}
