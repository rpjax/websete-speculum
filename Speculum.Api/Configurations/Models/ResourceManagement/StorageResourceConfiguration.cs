namespace Speculum.Api.Configurations.Models.ResourceManagement;

/// <summary>SQLite / journal storage budget and retention windows for Cleaner/Enforcer.</summary>
public sealed class StorageResourceConfiguration
{
    /// <summary>Soft ceiling for Speculum SQLite + journal payload bytes. Required for degradation.</summary>
    public long BudgetBytes { get; init; } = 2L * 1024 * 1024 * 1024; // 2 GiB

    /// <summary>Session-indexed journal facts (telemetry of sessions + associated logs).</summary>
    public TimeSpan SessionTelemetryRetention { get; init; } = TimeSpan.FromDays(7);

    /// <summary>Composite telemetry samples (<c>Telemetry.Sampling.SampleCollected</c>).</summary>
    public TimeSpan TelemetrySampleRetention { get; init; } = TimeSpan.FromDays(7);

    /// <summary>Remaining journal facts not covered by the tiers above.</summary>
    public TimeSpan JournalFactRetention { get; init; } = TimeSpan.FromDays(30);
}
