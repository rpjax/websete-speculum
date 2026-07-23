using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Sessions.Events.Models;

/// <summary>
/// Journal fact: a browser session reached Live
/// (Chrome ready, profile state restored, initial navigation completed).
/// </summary>
[JournalFact(
    "Sessions.SessionStarted",
    schemaVersion: 1,
    Name = "Session started",
    Description = "Session entered Live after provision, restore, and initial navigation.",
    Owner = "sessions",
    PublishPolicy = PublishPolicy.Guaranteed,
    EnabledByDefault = true)]
public sealed class SessionStarted
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }
}
