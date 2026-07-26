using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Profiles.Events;

/// <summary>Journal fact: an existing profile id was resolved on ensure.</summary>
[JournalFact(
    "Profiles.ProfileReused",
    schemaVersion: 1,
    Name = "Profile reused",
    Description = "Ensure resolved a known profile id without creating a new identity.",
    Owner = "profiles",
    PublishPolicy = PublishPolicy.Guaranteed,
    EnabledByDefault = true)]
public sealed class ProfileReused
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("correlation")]
    public string? CorrelationId { get; init; }
}
