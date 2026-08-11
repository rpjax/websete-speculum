using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Asset;

[JournalFact(
    "Telemetry.Sessions.PageProjection.Asset.ServeSlow",
    schemaVersion: 1,
    Name = "PageProjection asset · ServeSlow",
    Description = "PageEpoch parity telemetry: ServeSlow.",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class ServeSlow
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    public string UrlKey { get; init; } = "";

    public long DurationMs { get; init; }

    public int Status { get; init; }
}
