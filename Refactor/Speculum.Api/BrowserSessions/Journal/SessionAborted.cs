using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.BrowserSessions.Journal;

[JournalFact(
    "BrowserSessions.SessionAborted",
    schemaVersion: 1,
    Name = "Session aborted",
    Description = "Session provisioning failed before Live was reached.",
    Owner = "browser-sessions",
    PublishPolicy = PublishPolicy.Guaranteed,
    EnabledByDefault = true)]
public sealed class SessionAborted
{
    [JournalIndex("session")]
    public required Guid SessionId { get; init; }
}
