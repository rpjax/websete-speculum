using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Sessions.Events.Models;

[CanonicalFact(
    "Sessions.SessionAborted",
    schemaVersion: 2,
    Name = "Session aborted",
    Description = "Session provisioning failed before Live was reached.",
    Owner = "sessions",
    PublishPolicy = PublishPolicy.Guaranteed)]
public sealed class SessionAborted
{
    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("reason")]
    public required string Reason { get; init; }
}
