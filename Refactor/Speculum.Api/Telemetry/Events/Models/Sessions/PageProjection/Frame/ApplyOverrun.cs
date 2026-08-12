using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Frame;

[JournalFact(
    "Telemetry.Sessions.PageProjection.Frame.ApplyOverrun",
    schemaVersion: 1,
    Name = "PageProjection frame · ApplyOverrun",
    Description = "Client reported apply budget overrun (E9 / §5.15).",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class ApplyOverrun
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    public string PageEpochId { get; init; } = "";

    public long OverrunCount { get; init; }

    public long QueuedFrames { get; init; }

    public long Generation { get; init; }
}
