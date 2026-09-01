using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Sessions.Events.Models;

[CanonicalFact(
    "Sessions.ConnectionStarted",
    schemaVersion: 1,
    Name = "Browser connection started",
    Description = "Api↔sidecar browser connection was established (not the SignalR hub).",
    Owner = "sessions",
    PublishPolicy = PublishPolicy.Guaranteed)]
public sealed class ConnectionStarted
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }
}
