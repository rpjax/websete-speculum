using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Sessions.Events.Models;

[JournalFact(
    "Sessions.InputRejected",
    schemaVersion: 1,
    Name = "Input rejected",
    Description = "Sidecar rejected an input event (policy / state).",
    Owner = "sessions",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class InputRejected
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    public string? ErrorCode { get; init; }

    public string? Message { get; init; }

    public string? Phase { get; init; }
}
