using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Sessions.Events.Models;

[CanonicalFact(
    "Sessions.InitialNavigationFailed",
    schemaVersion: 2,
    Name = "Initial navigation failed",
    Description = "Initial navigation failed during start.",
    Owner = "sessions",
    PublishPolicy = PublishPolicy.Guaranteed)]
public sealed class InitialNavigationFailed
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    /// <summary>Failure phase: <c>Resolve</c> or <c>Navigate</c>.</summary>
    [JournalIndex("phase")]
    public required string Phase { get; init; }

    /// <summary>Resolved URL when phase is Navigate; null when resolve failed.</summary>
    public string? Url { get; init; }

    public required JournalError[] Errors { get; init; }
}
