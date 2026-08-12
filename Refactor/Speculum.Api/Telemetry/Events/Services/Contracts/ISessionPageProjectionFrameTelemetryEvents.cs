namespace Speculum.Api.Telemetry.Events.Services.Contracts;

public interface ISessionPageProjectionFrameTelemetryEvents
{
    void RateChanged(string pageEpochId, long fromHz, long toHz, long generation);
    void ClockStalled(string pageEpochId, long sinceLastTickMs, long generation);
    void ApplyOverrun(string pageEpochId, long overrunCount, long queuedFrames, long generation);
    void Aggregate(
        string pageEpochId,
        long generation,
        long framesEmitted,
        long bytesEmitted,
        long rateHz,
        long stallCount,
        long applyOverrunReports,
        long mirrorBytes,
        long intervalMs,
        long tVirtualMs);
}

public interface ISessionPageProjectionPoolTelemetryEvents
{
    void PoolAcquired(int maxWidth, int maxHeight, int poolSize, long waitMs);
    void PoolReleased(long heldMs);
}
