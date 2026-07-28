using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.Navigate;

[JournalFact(
    "Telemetry.Sessions.Navigate.UrlResolved",
    schemaVersion: 1,
    Name = "Navigate URL resolved",
    Description = "Runtime navigate path/query resolved to a target URL.",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class UrlResolved
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    public required string Url { get; init; }
}
