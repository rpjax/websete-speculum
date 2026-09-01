using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Sessions.Events.Models;

[CanonicalFact(
    "Sessions.ExportSessionStateSkipped",
    schemaVersion: 1,
    Name = "Export session state skipped",
    Description = "Session state export was skipped during stop (no connection or profile).",
    Owner = "sessions",
    PublishPolicy = PublishPolicy.Guaranteed)]
public sealed class ExportSessionStateSkipped
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    /// <summary>no_connection | profile_not_found</summary>
    [JournalIndex("reason")]
    public required string Reason { get; init; }
}
