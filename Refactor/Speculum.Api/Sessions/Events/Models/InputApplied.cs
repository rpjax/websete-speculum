using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Sessions.Events.Models;

/// <summary>
/// Test/debug trail for a successfully pushed input event.
/// Opt-in only — expensive; never enabled by default.
/// </summary>
[JournalFact(
    "Sessions.InputApplied",
    schemaVersion: 1,
    Name = "Input applied",
    Description = "User input was accepted and pushed to the sidecar (test/debug only).",
    Owner = "sessions",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class InputApplied
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    /// <summary>Wire input type (mousedown, touch, wheel, keydown, text, …).</summary>
    public required string Kind { get; init; }

    /// <summary>Optional sub-phase (e.g. touch start/move/end/cancel).</summary>
    public string? Phase { get; init; }
}
