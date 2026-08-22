using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Frame;

/// <summary>
/// OOB PageProjection.Resync snapshot served to the client (opt-in).
/// </summary>
[JournalFact(
    "Telemetry.Sessions.PageProjection.Frame.ResyncServed",
    schemaVersion: 2,
    Name = "PageProjection frame · resync served",
    Description = "API served a joint Dom+Cssom OOB resync snapshot after capture (phased durations).",
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
