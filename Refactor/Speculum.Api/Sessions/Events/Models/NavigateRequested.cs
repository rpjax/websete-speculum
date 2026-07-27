using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Sessions.Events.Models;

[CanonicalFact(
    "Sessions.NavigateRequested",
    schemaVersion: 1,
    Name = "Navigate requested",
    Description = "Runtime navigation was requested with a client path/query.",
    Owner = "sessions",
    PublishPolicy = PublishPolicy.Guaranteed)]
public sealed class NavigateRequested
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    public required string Path { get; init; }

    public required string Query { get; init; }
}
