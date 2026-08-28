using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Sessions.Events.Models;

/// <summary>
/// Journal fact: start was refused before <see cref="SessionStarting"/> (no provision began).
/// </summary>
[CanonicalFact(
    "Sessions.SessionStartRefused",
    schemaVersion: 1,
    Name = "Session start refused",
    Description = "Start refused before SessionStarting — drain, capacity, config, cancel, or replace failure.",
    Owner = "sessions",
    PublishPolicy = PublishPolicy.Guaranteed)]
public sealed class SessionStartRefused
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    /// <summary>
    /// draining | pending_config | no_slot | cancelled | disconnected | replace_failed
    /// </summary>
    [JournalIndex("reason")]
    public required string Reason { get; init; }

    public JournalError[]? Errors { get; init; }
}
