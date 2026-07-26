using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Sessions.Events.Models;

[JournalFact(
    "Sessions.NavigateUrlResolved",
    schemaVersion: 1,
    Name = "Navigate URL resolved",
    Description = "Runtime navigation path/query resolved to an absolute target URL.",
    Owner = "sessions",
    PublishPolicy = PublishPolicy.Guaranteed,
    EnabledByDefault = true)]
public sealed class NavigateUrlResolved
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    public required string Url { get; init; }
}
