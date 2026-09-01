using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Asset;

[JournalFact(
    "Telemetry.Sessions.PageProjection.Asset.RewriteSummary",
    schemaVersion: 1,
    Name = "PageProjection asset · RewriteSummary",
    Description = "PageEpoch parity telemetry: RewriteSummary.",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class RewriteSummary
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    public string PageEpochId { get; init; } = "";

    public int Candidates { get; init; }

    public int Rewritten { get; init; }

    public int BareSkipped { get; init; }

    public int DataInlined { get; init; }

    public int BlobQueued { get; init; }

    public int DeferredFetches { get; init; }

    public long TVirtualMs { get; init; }
}
