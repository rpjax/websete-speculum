using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Sessions.Events.Models;

[CanonicalFact(
    "Sessions.SessionAborted",
    schemaVersion: 3,
    Name = "Session aborted",
    Description = "Session provisioning failed after SessionStarting and before Live was reached.",
    Owner = "sessions",
    PublishPolicy = PublishPolicy.Guaranteed)]
public sealed class SessionAborted
{
    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("reason")]
    public required string Reason { get; init; }

    /// <summary>Optional failure detail from the aborting step (live bind, attach, etc.).</summary>
    public JournalError[]? Errors { get; init; }
}
