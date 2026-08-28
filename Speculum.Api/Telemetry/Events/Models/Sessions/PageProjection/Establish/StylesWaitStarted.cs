using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Establish;

[JournalFact(
    "Telemetry.Sessions.PageProjection.Establish.StylesWaitStarted",
    schemaVersion: 1,
    Name = "PageProjection establish · StylesWaitStarted",
    Description = "PageEpoch parity telemetry: StylesWaitStarted.",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class StylesWaitStarted
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    public string PageEpochId { get; init; } = "";

    public long Generation { get; init; }

    public int TimeoutMs { get; init; }

    public long TVirtualMs { get; init; }
}
