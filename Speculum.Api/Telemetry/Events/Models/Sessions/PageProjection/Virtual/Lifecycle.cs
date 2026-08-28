using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Virtual;

[JournalFact(
    "Telemetry.Sessions.PageProjection.Virtual.Lifecycle",
    schemaVersion: 1,
    Name = "PageProjection virtual · Lifecycle",
    Description = "PageEpoch parity telemetry: Lifecycle.",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class Lifecycle
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    public string PageEpochId { get; init; } = "";

    public string Name { get; init; } = "";

    public long? TSinceCommitMs { get; init; }

    public long TVirtualMs { get; init; }
}
