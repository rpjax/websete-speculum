using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Profiles.Events;

/// <summary>Journal fact: a new durable profile identity was issued.</summary>
[CanonicalFact(
    "Profiles.ProfileCreated",
    schemaVersion: 1,
    Name = "Profile created",
    Description = "A server-generated profile id was issued for a client ensure.",
    Owner = "profiles",
    PublishPolicy = PublishPolicy.Guaranteed)]
public sealed class ProfileCreated
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("correlation")]
    public string? CorrelationId { get; init; }
}
