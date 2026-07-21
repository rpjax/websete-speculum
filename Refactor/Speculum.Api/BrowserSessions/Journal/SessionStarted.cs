using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.BrowserSessions.Journal;

/// <summary>
/// Journal fact: a browser session reached Live
/// (Chrome ready, profile state restored, initial navigation completed).
/// </summary>
/// <remarks>
/// Example of attribute-declared Journal admission. Emit later via
/// <c>IJournalWriter.Append(new SessionStarted { ... })</c> — do not treat this as
/// an event-sourcing domain event.
/// </remarks>
[JournalFact(
    "BrowserSessions.SessionStarted",
    schemaVersion: 1,
    Name = "Session started",
    Description = "Session entered Live after provision, restore, and initial navigation.",
    Owner = "browser-sessions",
    PublishPolicy = PublishPolicy.Guaranteed,
    EnabledByDefault = true)]
public sealed class SessionStarted
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    public required bool Restored { get; init; }
}
