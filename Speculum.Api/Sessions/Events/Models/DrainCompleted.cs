using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Sessions.Events.Models;

[CanonicalFact(
    "Sessions.DrainCompleted",
    schemaVersion: 1,
    Name = "Session drain completed",
    Description = "Drain finished; remaining live sessions were ForceStopped after the soft budget when needed.",
    Owner = "sessions",
    PublishPolicy = PublishPolicy.Guaranteed)]
public sealed class DrainCompleted
{
    public required int SessionCount { get; init; }

    public required int ForcedCount { get; init; }

    [JournalIndex("trigger")]
    public required string Trigger { get; init; }
}
