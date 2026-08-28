using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Input;

/// <summary>
/// Virtual scroll sensor suppressed a Diff because an intent echo mark matched (contract hop).
/// </summary>
[JournalFact(
    "Telemetry.Sessions.PageProjection.Input.ScrollEchoHit",
    schemaVersion: 1,
    Name = "PageProjection input · scroll echo hit",
    Description = "Virtual scroll sensor dropped a Diff emit because NoteScrollEcho matched exactly.",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class ScrollEchoHit
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    /// <summary>viewport | element</summary>
    public required string Kind { get; init; }

    public long? Generation { get; init; }

    public string? Anchor { get; init; }

    public double? ScrollX { get; init; }

    public double? ScrollY { get; init; }

    public double? ScrollTop { get; init; }

    public double? ScrollLeft { get; init; }
}
