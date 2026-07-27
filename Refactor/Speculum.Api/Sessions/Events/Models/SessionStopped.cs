using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Sessions.Events.Models;

[CanonicalFact(
    "Sessions.SessionStopped",
    schemaVersion: 2,
    Name = "Session stopped",
    Description = "Session left Live after an explicit stop.",
    Owner = "sessions",
    PublishPolicy = PublishPolicy.Guaranteed)]
public sealed class SessionStopped
{
    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("reason")]
    public required string Reason { get; init; }
}
