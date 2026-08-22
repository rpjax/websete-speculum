using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Establish;

[JournalFact(
    "Telemetry.Sessions.PageProjection.Establish.FirstFrameEmitted",
    schemaVersion: 1,
    Name = "PageProjection establish · FirstFrameEmitted",
    Description = "PageEpoch parity telemetry: FirstFrameEmitted.",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class FirstFrameEmitted
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    public string PageEpochId { get; init; } = "";

    public long Generation { get; init; }

    public string Plane { get; init; } = "";

    public string Operation { get; init; } = "";

    public long Sequence { get; init; }

    public long? TSinceCommitMs { get; init; }

    public long TVirtualMs { get; init; }
}
