using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Diff;

/// <summary>
/// OOB PageProjection.Resync snapshot served to the client (opt-in).
/// </summary>
[JournalFact(
    "Telemetry.Sessions.PageProjection.Diff.ResyncServed",
    schemaVersion: 1,
    Name = "PageProjection diff · resync served",
    Description = "API served a joint Dom+Cssom OOB resync snapshot after capture.",
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
}
