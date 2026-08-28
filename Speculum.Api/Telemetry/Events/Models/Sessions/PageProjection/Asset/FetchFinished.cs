using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Asset;

[JournalFact(
    "Telemetry.Sessions.PageProjection.Asset.FetchFinished",
    schemaVersion: 1,
    Name = "PageProjection asset · FetchFinished",
    Description = "PageEpoch parity telemetry: FetchFinished.",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class FetchFinished
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    public string PageEpochId { get; init; } = "";

    public string UrlKey { get; init; } = "";

    public long DurationMs { get; init; }

    public long Bytes { get; init; }

    public string Mode { get; init; } = "";

    public bool Ok { get; init; }

    public long TVirtualMs { get; init; }
}
