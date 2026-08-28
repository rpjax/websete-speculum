using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Profiles.Events;

/// <summary>Journal fact: ensure resolved a known profile id without creating a new identity.</summary>
[CanonicalFact(
    "Profiles.ProfileEnsureExisting",
    schemaVersion: 1,
    Name = "Profile ensure (existing)",
    Description = "Ensure resolved a known profile id without creating a new identity.",
    Owner = "profiles",
    PublishPolicy = PublishPolicy.Guaranteed)]
public sealed class ProfileEnsureExisting
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("correlation")]
    public string? CorrelationId { get; init; }
}
