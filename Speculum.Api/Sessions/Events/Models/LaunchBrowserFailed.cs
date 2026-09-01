using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Sessions.Events.Models;

[CanonicalFact(
    "Sessions.LaunchBrowserFailed",
    schemaVersion: 1,
    Name = "Launch browser failed",
    Description = "Chrome launch failed during start.",
    Owner = "sessions",
    PublishPolicy = PublishPolicy.Guaranteed)]
public sealed class LaunchBrowserFailed
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    public required JournalError[] Errors { get; init; }
}
