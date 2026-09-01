using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Virtual;

[JournalFact(
    "Telemetry.Sessions.PageProjection.Virtual.NavTiming",
    schemaVersion: 1,
    Name = "PageProjection virtual · NavTiming",
    Description = "PageEpoch parity telemetry: NavTiming.",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class NavTiming
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    public string PageEpochId { get; init; } = "";

    public long? RedirectMs { get; init; }

    public long? DnsMs { get; init; }

    public long? ConnectMs { get; init; }

    public long? TtfbMs { get; init; }

    public long? DomInteractiveMs { get; init; }

    public long? DomContentLoadedMs { get; init; }

    public long? LoadEventMs { get; init; }

    public long TVirtualMs { get; init; }
}
