namespace Speculum.Api.Telemetry.Events.Services.Contracts;

public interface ISessionPageProjectionVirtualTelemetryEvents
{
    void BootMarked(long browserLaunchedAtMs, long firstCommitAtMs, long bootMs, string? pageEpochId);
    void NavCommit(string pageEpochId, string? url, long generation, string? documentEpoch, string navigationType, long tVirtualMs);
    void NavTiming(
        string pageEpochId,
        long? redirectMs,
        long? dnsMs,
        long? connectMs,
        long? ttfbMs,
        long? domInteractiveMs,
        long? domContentLoadedMs,
        long? loadEventMs,
        long tVirtualMs);
    void ResourceSummary(string pageEpochId, string byTypeJson, string topSlowJson, long tVirtualMs);
    void PageError(string pageEpochId, string source, string message, string? urlKey, int count, long tVirtualMs);
    void Lifecycle(string pageEpochId, string name, long? tSinceCommitMs, long tVirtualMs);
}
