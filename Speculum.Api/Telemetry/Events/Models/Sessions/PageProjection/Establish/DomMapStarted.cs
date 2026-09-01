using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Establish;

[JournalFact(
    "Telemetry.Sessions.PageProjection.Establish.DomMapStarted",
    schemaVersion: 1,
    Name = "PageProjection establish · DomMapStarted",
    Description = "Legacy DomMap name — V4 cold/resync does not dump DomMap over the wire; keep for residual journal only.",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class DomMapStarted
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    public string PageEpochId { get; init; } = "";

    public long Generation { get; init; }

    public string Path { get; init; } = "";

    public long TVirtualMs { get; init; }
}
