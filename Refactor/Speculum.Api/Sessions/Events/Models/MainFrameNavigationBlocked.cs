using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Sessions.Events.Models;

[JournalFact(
    "Sessions.MainFrameNavigationBlocked",
    schemaVersion: 1,
    Name = "Main-frame navigation blocked",
    Description = "Browser blocked a main-frame navigation (allowlist / policy).",
    Owner = "sessions",
    PublishPolicy = PublishPolicy.Guaranteed,
    EnabledByDefault = true)]
public sealed class MainFrameNavigationBlocked
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    public required string Url { get; init; }

    public string? ErrorCode { get; init; }

    public string? Message { get; init; }
}
