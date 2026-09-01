using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Frame;

[JournalFact(
    "Telemetry.Sessions.PageProjection.Frame.RateChanged",
    schemaVersion: 1,
    Name = "PageProjection frame · RateChanged",
    Description = "Frame clock rate ladder step (§5.3.5 / §5.15).",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class RateChanged
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    public string PageEpochId { get; init; } = "";

    public long FromHz { get; init; }

    public long ToHz { get; init; }

    public long Generation { get; init; }
}
