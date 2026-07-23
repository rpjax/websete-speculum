using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Sessions.Events.Models;

[JournalFact(
    "Sessions.ProfileNotFound",
    schemaVersion: 1,
    Name = "Profile not found",
    Description = "Start rejected because the profile does not exist.",
    Owner = "sessions",
    PublishPolicy = PublishPolicy.BestEffort,
    EnabledByDefault = true)]
public sealed class ProfileNotFound
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }
}
