using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Sessions.Events.Models;

[JournalFact(
    "Sessions.ProfileStateRestored",
    schemaVersion: 1,
    Name = "Profile state restored",
    Description = "Persisted profile state was restored into the browser.",
    Owner = "sessions",
    PublishPolicy = PublishPolicy.BestEffort,
    EnabledByDefault = true)]
public sealed class ProfileStateRestored
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }
}
