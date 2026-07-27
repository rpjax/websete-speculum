using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Sessions.Events.Models;

/// <summary>
/// Test/debug trail for a successful viewport resize.
/// Opt-in only — never enabled by default.
/// </summary>
[JournalFact(
    "Sessions.ResizeApplied",
    schemaVersion: 1,
    Name = "Resize applied",
    Description = "Session viewport resize was applied (test/debug only).",
    Owner = "sessions",
    PublishPolicy = PublishPolicy.BestEffort,
    EnabledByDefault = false)]
public sealed class ResizeApplied
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    public required int Width { get; init; }

    public required int Height { get; init; }

    public string? ResizeId { get; init; }
}
