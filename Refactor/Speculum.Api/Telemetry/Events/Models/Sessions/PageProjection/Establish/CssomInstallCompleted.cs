using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Establish;

[JournalFact(
    "Telemetry.Sessions.PageProjection.Establish.CssomInstallCompleted",
    schemaVersion: 1,
    Name = "PageProjection establish · CssomInstallCompleted",
    Description = "PageEpoch parity telemetry: CssomInstallCompleted.",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class CssomInstallCompleted
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    public string PageEpochId { get; init; } = "";

    public long Generation { get; init; }

    public string Source { get; init; } = "";

    public long DurationMs { get; init; }

    public int SheetCount { get; init; }

    public int RuleCount { get; init; }

    public int SeededSheetCount { get; init; }

    public long TVirtualMs { get; init; }
}
