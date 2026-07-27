using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Sessions.Events.Models;

[CanonicalFact(
    "Sessions.BrowserCrashed",
    schemaVersion: 1,
    Name = "Browser crashed",
    Description = "Sidecar reported a browser crash notification.",
    Owner = "sessions",
    PublishPolicy = PublishPolicy.Guaranteed)]
public sealed class BrowserCrashed
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    public string? ErrorCode { get; init; }

    public string? Message { get; init; }

    public string? Phase { get; init; }
}
