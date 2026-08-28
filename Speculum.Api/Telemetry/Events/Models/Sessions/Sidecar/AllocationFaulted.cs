using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.Sidecar;

[JournalFact(
    "Telemetry.Sessions.Sidecar.AllocationFaulted",
    schemaVersion: 1,
    Name = "Sidecar allocation faulted",
    Description = "Sidecar failed to allocate or prove session/display resources.",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class AllocationFaulted
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
    public required string ErrorCode { get; init; }
    public required string Phase { get; init; }
    public string? Reason { get; init; }
}
