using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Sessions.Events.Models;

/// <summary>
/// Live session left the live phase via fault abandon (crash, link death, etc.).
/// Distinct from <see cref="SessionAborted"/> (provisioning never reached Live).
/// </summary>
[CanonicalFact(
    "Sessions.LiveSessionAbandoned",
    schemaVersion: 1,
    Name = "Live session abandoned",
    Description = "A live session was abandoned (SessionEnded + Faulted stop). Covers Chromium crash and sidecar link death.",
    Owner = "sessions",
    PublishPolicy = PublishPolicy.Guaranteed)]
public sealed class LiveSessionAbandoned
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    [JournalIndex("reason")]
    public required string Reason { get; init; }

    public string? ErrorCode { get; init; }

    public string? Message { get; init; }
}
