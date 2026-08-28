using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Frame;

/// <summary>
/// Client requested OOB PageProjection.Resync (opt-in).
/// </summary>
[JournalFact(
    "Telemetry.Sessions.PageProjection.Frame.ResyncRequested",
    schemaVersion: 1,
    Name = "PageProjection frame · resync requested",
    Description = "Client POST page-projection/resync — joint Dom+Cssom OOB snapshot requested.",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class ResyncRequested
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    public long HintGeneration { get; init; }

    public long HintSequence { get; init; }
}
