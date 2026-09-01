using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Profiles.Events;

/// <summary>Journal fact: operator replaced the durable profile state bucket.</summary>
[CanonicalFact(
    "Profiles.ProfileStateReplaced",
    schemaVersion: 1,
    Name = "Profile state replaced",
    Description = "Diagnostics or operator replaced persisted browser state for a profile.",
    Owner = "profiles",
    PublishPolicy = PublishPolicy.Guaranteed)]
public sealed class ProfileStateReplaced
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("correlation")]
    public string? CorrelationId { get; init; }

    public int CookieCount { get; init; }
}
