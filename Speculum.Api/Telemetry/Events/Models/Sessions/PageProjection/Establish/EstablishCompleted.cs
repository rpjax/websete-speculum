using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Establish;

[JournalFact(
    "Telemetry.Sessions.PageProjection.Establish.EstablishCompleted",
    schemaVersion: 1,
    Name = "PageProjection establish · EstablishCompleted",
    Description = "PageEpoch parity telemetry: EstablishCompleted.",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class EstablishCompleted
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    public string PageEpochId { get; init; } = "";

    public long Generation { get; init; }

    public long TotalMs { get; init; }

    public long? TSinceCommitMs { get; init; }

    public long TVirtualMs { get; init; }
}
