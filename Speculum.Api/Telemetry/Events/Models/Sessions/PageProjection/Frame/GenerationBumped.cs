using Speculum.Api.Journal.Attributes;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Telemetry.Events.Models.Sessions.PageProjection.Frame;

/// <summary>
/// PageProjection generation identity changed in the sidecar (opt-in debug hop).
/// Contract: bump on top-level Document replace; Dom/Cssom share one chronological emitter.
/// </summary>
[JournalFact(
    "Telemetry.Sessions.PageProjection.Frame.GenerationBumped",
    schemaVersion: 1,
    Name = "PageProjection frame · generation bumped",
    Description = "Sidecar PageProjection generation changed (main_frame_navigated or page_emit_sync).",
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

    /// <summary>When reason is page_emit_sync: dom | cssom.</summary>
    public string? FrameKind { get; init; }
}
