using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Sessions.Events.Models;

[JournalFact(
    "Sessions.StartConfigurationRejected",
    schemaVersion: 1,
    Name = "Start configuration rejected",
    Description = "Start rejected because required engine configuration or mimicry is invalid.",
    Owner = "sessions",
    PublishPolicy = PublishPolicy.BestEffort,
    EnabledByDefault = true)]
public sealed class StartConfigurationRejected
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    public required string[] Errors { get; init; }
}
