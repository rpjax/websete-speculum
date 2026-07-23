using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Sessions.Events.Models;

[JournalFact(
    "Sessions.PersistSkippedProfileNotFound",
    schemaVersion: 1,
    Name = "Persist skipped profile not found",
    Description = "State persist skipped because the profile no longer exists.",
    Owner = "sessions",
    PublishPolicy = PublishPolicy.BestEffort,
    EnabledByDefault = true)]
public sealed class PersistSkippedProfileNotFound
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }
}
