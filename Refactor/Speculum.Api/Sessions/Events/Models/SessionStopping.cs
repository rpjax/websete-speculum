using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Sessions.Events.Models;

[JournalFact(
    "Sessions.SessionStopping",
    schemaVersion: 2,
    Name = "Session stopping",
    Description = "Session teardown began.",
    Owner = "sessions",
    PublishPolicy = PublishPolicy.Guaranteed,
    EnabledByDefault = true)]
public sealed class SessionStopping
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    [JournalIndex("reason")]
    public required string Reason { get; init; }
}
