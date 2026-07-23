using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Sessions.Events.Models;

[JournalFact(
    "Sessions.SessionStopped",
    schemaVersion: 1,
    Name = "Session stopped",
    Description = "Session left Live after an explicit stop.",
    Owner = "sessions",
    PublishPolicy = PublishPolicy.Guaranteed,
    EnabledByDefault = true)]
public sealed class SessionStopped
{
    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }
}
