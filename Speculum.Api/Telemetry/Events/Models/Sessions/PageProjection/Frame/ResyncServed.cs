using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Frame;

/// <summary>
/// Legacy name: resync completion telemetry. Product path delivers a resync-flagged frame on the
/// Diff stream — not an OOB HTTP snapshot body.
/// </summary>
[JournalFact(
    "Telemetry.Sessions.PageProjection.Frame.ResyncServed",
    schemaVersion: 2,
    Name = "PageProjection frame · resync served",
    Description = "Resync completed; the resync-flagged frame is on the Diff stream (not an OOB snapshot HTTP body). Phased durations are diagnostic.",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class ResyncServed
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    public long Generation { get; init; }

    public long CoversThroughSequence { get; init; }

    public int SheetCount { get; init; }

    public int RuleCount { get; init; }

    public int SeededSheetCount { get; init; }

    public long DurationMs { get; init; }

    public string? PageEpochId { get; init; }

    public string? Source { get; init; }

    public long DomMapMs { get; init; }

    public long CssomCloneMs { get; init; }

    public long RewriteMs { get; init; }

    public long SerializeMs { get; init; }
}
