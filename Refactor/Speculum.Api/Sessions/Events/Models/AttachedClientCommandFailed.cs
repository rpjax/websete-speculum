using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Sessions.Events.Models;

/// <summary>
/// Push of SyncUrl/Redirect to the attached browser client failed (SignalR or validation).
/// </summary>
[JournalFact(
    "Sessions.AttachedClientCommandFailed",
    schemaVersion: 1,
    Name = "Attached client command failed",
    Description = "Best-effort SyncUrl or Redirect to the attached client failed.",
    Owner = "sessions",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class AttachedClientCommandFailed
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    /// <summary>Command name: <c>SyncUrl</c> or <c>Redirect</c>.</summary>
    [JournalIndex("command")]
    public required string Command { get; init; }

    public required JournalError[] Errors { get; init; }
}
