using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Sessions.Events.Models;

[CanonicalFact(
    "Sessions.NavigateFailed",
    schemaVersion: 1,
    Name = "Navigate failed",
    Description = "Runtime navigation failed during URL resolve or browser command.",
    Owner = "sessions",
    PublishPolicy = PublishPolicy.Guaranteed)]
public sealed class NavigateFailed
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    /// <summary>Failure phase: <c>Resolve</c> or <c>Navigate</c>.</summary>
    [JournalIndex("phase")]
    public required string Phase { get; init; }

    public required JournalError[] Errors { get; init; }
}
