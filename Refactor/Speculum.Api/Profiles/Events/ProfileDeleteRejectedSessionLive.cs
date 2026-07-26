using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Profiles.Events;

/// <summary>
/// Journal fact: profile delete was rejected because a live session still owns the profile.
/// </summary>
[JournalFact(
    "Profiles.ProfileDeleteRejectedSessionLive",
    schemaVersion: 1,
    Name = "Profile delete rejected (session live)",
    Description = "Delete refused while a session in Live still references the profile.",
    Owner = "profiles",
    PublishPolicy = PublishPolicy.Guaranteed,
    EnabledByDefault = true)]
public sealed class ProfileDeleteRejectedSessionLive
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("correlation")]
    public string? CorrelationId { get; init; }
}
