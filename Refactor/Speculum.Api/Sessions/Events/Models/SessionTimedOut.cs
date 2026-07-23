using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Sessions.Events.Models;

[JournalFact(
    "Sessions.SessionTimedOut",
    schemaVersion: 1,
    Name = "Session timed out",
    Description = "Detached session exceeded DetachedSessionTimeout with zero active pipes.",
    Owner = "sessions",
    PublishPolicy = PublishPolicy.Guaranteed,
    EnabledByDefault = true)]
public sealed class SessionTimedOut
{
    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }
}
