using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.Sidecar;

[JournalFact(
    "Telemetry.Sessions.Sidecar.DisplayAllocated",
    schemaVersion: 1,
    Name = "Sidecar display allocated",
    Description = "Sidecar allocated an X display for a session.",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class DisplayAllocated
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    public int? DisplayWidth { get; init; }
    public int? DisplayHeight { get; init; }
    public int? LogicalWidth { get; init; }
    public int? LogicalHeight { get; init; }
    public string? InputBackend { get; init; }
}
