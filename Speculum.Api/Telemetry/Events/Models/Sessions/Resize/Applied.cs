using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.Resize;

[JournalFact(
    "Telemetry.Sessions.Resize.Applied",
    schemaVersion: 1,
    Name = "Resize applied",
    Description = "Session viewport resize was applied.",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class Applied
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    public int Width { get; init; }

    public int Height { get; init; }

    public string? ResizeId { get; init; }
}
