using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Virtual;

[JournalFact(
    "Telemetry.Sessions.PageProjection.Virtual.NavCommit",
    schemaVersion: 1,
    Name = "PageProjection virtual · NavCommit",
    Description = "PageEpoch parity telemetry: NavCommit.",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class NavCommit
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    public string PageEpochId { get; init; } = "";

    public string? Url { get; init; }

    public long Generation { get; init; }

    public string? DocumentEpoch { get; init; }

    public string NavigationType { get; init; } = "";

    public long TVirtualMs { get; init; }
}
