namespace Speculum.Api.Telemetry.Events.Services.Contracts;

public interface ISessionPageProjectionAssetTelemetryEvents
{
    void RewriteSummary(
        string pageEpochId,
        int candidates,
        int rewritten,
        int bareSkipped,
        int dataInlined,
        int blobQueued,
        int deferredFetches,
        long tVirtualMs);
    void FetchFinished(
        string pageEpochId,
        string urlKey,
        long durationMs,
        long bytes,
        string mode,
        bool ok,
        long tVirtualMs);
    void ServeMiss(string urlKey, long durationMs, int status);
    void ServeSlow(string urlKey, long durationMs, int status);
}
