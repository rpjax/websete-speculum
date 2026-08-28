using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Establish;

[JournalFact(
    "Telemetry.Sessions.PageProjection.Establish.StylesWaitCompleted",
    schemaVersion: 1,
    Name = "PageProjection establish · StylesWaitCompleted",
    Description = "PageEpoch parity telemetry: StylesWaitCompleted.",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class StylesWaitCompleted
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    public string PageEpochId { get; init; } = "";

    public long Generation { get; init; }

    public int TimeoutMs { get; init; }

    public long WaitedMs { get; init; }

    public bool TimedOut { get; init; }

    public long TVirtualMs { get; init; }
}
