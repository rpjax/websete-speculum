using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.DomProjection.Diff;

/// <summary>
/// Dom Projection generation identity changed in the sidecar (opt-in debug hop).
/// Contract: bump on top-level navigation; Dom Diffs share one chronological emitter
/// (<c>kind=diff</c>, <c>target=document|anchors</c>).
/// </summary>
[JournalFact(
    "Telemetry.Sessions.DomProjection.Diff.GenerationBumped",
    schemaVersion: 1,
    Name = "Dom Projection diff · generation bumped",
    Description = "Sidecar Dom Projection generation changed (main_frame_navigated or page_emit_sync).",
    Owner = "telemetry",
    PublishPolicy = PublishPolicy.BestEffort)]
public sealed class GenerationBumped
{
    [JournalIndex("profile")]
    public required Guid ProfileId { get; init; }

    [JournalIndex("session")]
    public required Guid SessionId { get; init; }

    public long FromGeneration { get; init; }

    public long ToGeneration { get; init; }

    /// <summary>main_frame_navigated | page_emit_sync</summary>
    public required string Reason { get; init; }

    public string? Url { get; init; }

    /// <summary>When reason is page_emit_sync: diff | cssom.</summary>
    public string? DiffKind { get; init; }
}
