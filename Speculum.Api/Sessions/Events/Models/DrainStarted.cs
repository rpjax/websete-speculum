using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Sessions.Events.Models;

[CanonicalFact(
    "Sessions.DrainStarted",
    schemaVersion: 1,
    Name = "Session drain started",
    Description = "Configuration Apply or process shutdown began draining live and starting sessions.",
    Owner = "sessions",
    PublishPolicy = PublishPolicy.Guaranteed)]
public sealed class DrainStarted
{
    public required int SessionCount { get; init; }

    [JournalIndex("trigger")]
    public required string Trigger { get; init; }
}
