using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Virtual;

[JournalFact(
    "Telemetry.Sessions.PageProjection.Virtual.BootMarked",
    schemaVersion: 1,
    Name = "PageProjection virtual · BootMarked",
    Description = "PageEpoch parity telemetry: BootMarked.",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class BootMarked
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    public long BrowserLaunchedAtMs { get; init; }

    public long FirstCommitAtMs { get; init; }

    public long BootMs { get; init; }

    public string? PageEpochId { get; init; }
}
