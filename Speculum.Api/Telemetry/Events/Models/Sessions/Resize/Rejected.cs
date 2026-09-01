using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.Resize;

[JournalFact(
    "Telemetry.Sessions.Resize.Rejected",
    schemaVersion: 1,
    Name = "Resize rejected",
    Description = "Session viewport resize was rejected.",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class Rejected
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

    [JournalIndex("phase")]
    public string? Phase { get; init; }
}
