using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Sessions.Events.Models;

[JournalFact(
    "Sessions.NavigateCompleted",
    schemaVersion: 1,
    Name = "Navigate completed",
    Description = "Runtime navigation command was accepted by the browser connection.",
    Owner = "sessions",
    PublishPolicy = PublishPolicy.Guaranteed,
    EnabledByDefault = true)]
public sealed class NavigateCompleted
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    public required string Url { get; init; }
}
