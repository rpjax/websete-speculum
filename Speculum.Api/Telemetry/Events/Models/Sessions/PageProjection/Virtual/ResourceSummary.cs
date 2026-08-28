using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Virtual;

[JournalFact(
    "Telemetry.Sessions.PageProjection.Virtual.ResourceSummary",
    schemaVersion: 1,
    Name = "PageProjection virtual · ResourceSummary",
    Description = "PageEpoch parity telemetry: ResourceSummary.",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class ResourceSummary
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    public string PageEpochId { get; init; } = "";

    public string ByTypeJson { get; init; } = "[]";

    public string TopSlowJson { get; init; } = "[]";

    public long TVirtualMs { get; init; }
}
