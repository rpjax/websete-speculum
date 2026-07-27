using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;
using Speculum.Api.Profiles.Aggregates;

namespace Speculum.Api.Profiles.Events;

/// <summary>Journal fact: a persisted profile identity was deleted.</summary>
[CanonicalFact(
    "Profiles.ProfileDeleted",
    schemaVersion: 1,
    Name = "Profile deleted",
    Description = "Operator deleted a persisted profile identity and its state bucket.",
    Owner = "profiles",
    PublishPolicy = PublishPolicy.Guaranteed)]
public sealed class ProfileDeleted
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    public required ProfileDeletionReason Reason { get; init; }

    [JournalIndex("correlation")]
    public string? CorrelationId { get; init; }
}
