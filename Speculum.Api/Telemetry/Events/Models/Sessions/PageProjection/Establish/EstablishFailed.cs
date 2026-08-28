using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Establish;

[JournalFact(
    "Telemetry.Sessions.PageProjection.Establish.EstablishFailed",
    schemaVersion: 1,
    Name = "PageProjection establish · EstablishFailed",
    Description = "PageEpoch parity telemetry: EstablishFailed.",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class EstablishFailed
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    public string PageEpochId { get; init; } = "";

    public long Generation { get; init; }

    public string ErrorCode { get; init; } = "";

    public string Phase { get; init; } = "";

    public string? Message { get; init; }

    public long TVirtualMs { get; init; }
}
