using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Sessions.Events.Models;

[CanonicalFact(
    "Sessions.CloseConnectionFailed",
    schemaVersion: 1,
    Name = "Close browser connection failed",
    Description = "Closing the Api↔sidecar browser connection failed during teardown.",
    Owner = "sessions",
    PublishPolicy = PublishPolicy.Guaranteed)]
public sealed class CloseConnectionFailed
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    public required JournalError[] Errors { get; init; }
}
