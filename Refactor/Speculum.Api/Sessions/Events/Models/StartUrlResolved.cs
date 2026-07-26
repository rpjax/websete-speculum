using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Sessions.Events.Models;

[JournalFact(
    "Sessions.StartUrlResolved",
    schemaVersion: 1,
    Name = "Start URL resolved",
    Description = "The target URL for start navigation was resolved.",
    Owner = "sessions",
    PublishPolicy = PublishPolicy.BestEffort,
    EnabledByDefault = true)]
public sealed class StartUrlResolved
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    public required string Url { get; init; }
}
