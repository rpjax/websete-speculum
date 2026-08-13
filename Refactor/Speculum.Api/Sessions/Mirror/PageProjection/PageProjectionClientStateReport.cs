namespace Speculum.Api.Sessions.Mirror.PageProjection;

/// <summary>
/// Client → server control channel (docs/page-projection/spec/engine-redesign.md §5.9.5).
/// A control report, not a diff — carries no `sequence` and never advances one.
/// </summary>
public sealed class PageProjectionClientStateReport
{
    /// <summary>"visible" | "hidden" (§5.3.5.3).</summary>
    public required string Visibility { get; init; }

    public long AppliedThroughSequence { get; init; }

    public int QueuedFrames { get; init; }

    public double ApplyP50Ms { get; init; }

    public double ApplyP95Ms { get; init; }

    /// <summary>Applies exceeding `applyBudgetMs` (E9) since the last report.</summary>
    public int OverrunCount { get; init; }
}
