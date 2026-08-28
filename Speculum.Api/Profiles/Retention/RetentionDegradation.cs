using Speculum.Api.Configurations.Models.ResourceManagement;

namespace Speculum.Api.Profiles.Retention;

public enum RetentionDegradationLevel
{
    None = 0,
    /// <summary>Purge expired session-indexed journal telemetry.</summary>
    SessionTelemetry = 1,
    /// <summary>Also purge expired telemetry samples.</summary>
    TelemetrySamples = 2,
    /// <summary>Also purge remaining expired journal facts.</summary>
    JournalFacts = 3,
    /// <summary>Also purge inactive profiles (atomic, LastUsedAt ASC).</summary>
    Profiles = 4,
}

public static class RetentionDegradation
{
    /// <summary>
    /// Maps usage/budget ratio to aggressiveness. Thresholds are inclusive upper bounds.
    /// </summary>
    public static RetentionDegradationLevel FromUsage(long usedBytes, long budgetBytes)
    {
        if (budgetBytes <= 0)
            return RetentionDegradationLevel.Profiles;

        var ratio = (double)usedBytes / budgetBytes;
        if (ratio < 0.70)
            return RetentionDegradationLevel.None;
        if (ratio < 0.80)
            return RetentionDegradationLevel.SessionTelemetry;
        if (ratio < 0.90)
            return RetentionDegradationLevel.TelemetrySamples;
        if (ratio < 0.95)
            return RetentionDegradationLevel.JournalFacts;
        return RetentionDegradationLevel.Profiles;
    }
}
