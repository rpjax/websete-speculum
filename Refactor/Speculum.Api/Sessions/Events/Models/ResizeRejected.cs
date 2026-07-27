using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Sessions.Events.Models;

/// <summary>
/// Test/debug trail for a rejected viewport resize.
/// Opt-in only — never enabled by default.
/// </summary>
[JournalFact(
    "Sessions.ResizeRejected",
    schemaVersion: 1,
    Name = "Resize rejected",
    Description = "Session viewport resize was rejected (test/debug only).",
    Owner = "sessions",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class ResizeRejected
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    public int? Width { get; init; }

    public int? Height { get; init; }

    public string? ResizeId { get; init; }

    public string? ErrorCode { get; init; }

    public string? Message { get; init; }

    public string? Phase { get; init; }
}
