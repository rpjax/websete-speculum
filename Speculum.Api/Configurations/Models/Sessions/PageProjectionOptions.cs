namespace Speculum.Api.Configurations.Models.Sessions;

/// <summary>
/// Runtime-configurable knobs for the PageProjection engine — Sessions → PageProjection
/// (<c>docs/page-projection/spec/engine-redesign.md</c> §5.16). Every value is a starting
/// default that <c>WP14</c> density calibration is expected to revise.
/// </summary>
public sealed class PageProjectionOptions
{
    /// <summary>Target frame-clock rate (§5.3.4). Unthrottled, timer-based — never rAF.</summary>
    public int FrameRateHz { get; init; } = 60;

    /// <summary>Degradation steps, highest first (§5.3.5.1). Recovery walks back one step at a time.</summary>
    public IReadOnlyList<int> FrameRateLadder { get; init; } = [60, 30, 15, 5];

    /// <summary>Rate while the client reports <c>hidden</c> (§5.3.5.3). Mutations keep accumulating.</summary>
    public int HiddenRateHz { get; init; } = 1;

    /// <summary>Minimum interval between upward rate steps (§5.3.5.2) — avoids oscillation.</summary>
    public int RateRecoverMs { get; init; } = 5000;

    /// <summary>Clock watchdog (§5.3.4.4): forces a flush if page activity is observed with no frame this long.</summary>
    public int FrameStallMs { get; init; } = 1000;

    /// <summary>One wire message cap (§5.3.5.5); an exceeding frame is split into parts, never dropped.</summary>
    public int MaxFrameBytes { get; init; } = 1024 * 1024;

    /// <summary>
    /// Obsolete pre-V4 establish chunking knob. Cold start is a resync-flagged frame — this value
    /// is ignored on Launch (kept only so SQLite/admin JSON still round-trips).
    /// </summary>
    [Obsolete("V4 cold start is resync frame; establish chunking is dead. Ignored on Launch.")]
    public int EstablishChunkBytes { get; init; } = 64 * 1024;

    /// <summary>Double-buffer swap fallback (§5.8.5) when the first-meaningful-paint threshold is not reached.</summary>
    public int SwapTimeoutMs { get; init; } = 1500;

    /// <summary>
    /// Obsolete — <c>ReportPageProjectionClientState</c> was purged. Ignored on Launch and not a
    /// Live control-channel interval. Kept for SQLite/admin JSON round-trip only.
    /// </summary>
    [Obsolete("ReportClientState purged; ClientStateMs is dead. Ignored on Launch.")]
    public int ClientStateMs { get; init; } = 1000;

    /// <summary>Client frame-apply overrun threshold (E9) — reported, does not block.</summary>
    public int ApplyBudgetMs { get; init; } = 4;

    /// <summary>Per-session Node mirror byte cap (E7).</summary>
    public long MirrorMaxBytes { get; init; } = 32L * 1024 * 1024;

    /// <summary>Per-session L1 asset cache LRU byte cap (E7, §5.12.2).</summary>
    public long AssetCacheL1MaxBytes { get; init; } = 8L * 1024 * 1024;

    /// <summary>Host-wide shared L2 asset tier LRU byte cap (E7b, §5.12.2).</summary>
    public long AssetCacheL2MaxBytes { get; init; } = 1L << 30;

    /// <summary>Kill switch for the shared L2 tier; <c>false</c> ⇒ every session is L1-only.</summary>
    public bool AssetCacheL2Enabled { get; init; } = true;

    /// <summary>In-viewport prefetch margin, in CSS px, for asset priority (§5.12.1).</summary>
    public int AssetPriorityViewportPx { get; init; } = 200;

    /// <summary>Pre-warmed, never-navigated browser pool size (§5.13, WP13).</summary>
    public int BrowserPoolSize { get; init; } = 8;

    /// <summary>Pool refill throttle, instances per second (§5.13) — bounds a burst of session starts.</summary>
    public int BrowserPoolRefillPerSec { get; init; } = 2;

    /// <summary><c>Frame.Aggregate</c> telemetry period (§5.15).</summary>
    public int AggregateIntervalMs { get; init; } = 10_000;
}
