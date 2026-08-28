using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Virtual;

[JournalFact(
    "Telemetry.Sessions.PageProjection.Virtual.PageError",
    schemaVersion: 1,
    Name = "PageProjection virtual · PageError",
    Description = "PageEpoch parity telemetry: PageError.",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class PageError
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    public string PageEpochId { get; init; } = "";

    public string Source { get; init; } = "";

    public string Message { get; init; } = "";

    public string? UrlKey { get; init; }

    public int Count { get; init; }

    public long TVirtualMs { get; init; }
}
