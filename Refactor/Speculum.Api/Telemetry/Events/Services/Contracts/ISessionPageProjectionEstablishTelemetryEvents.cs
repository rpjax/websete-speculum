namespace Speculum.Api.Telemetry.Events.Services.Contracts;

public interface ISessionPageProjectionEstablishTelemetryEvents
{
    void StylesWaitStarted(string pageEpochId, long generation, int timeoutMs, long tVirtualMs);
    void StylesWaitCompleted(string pageEpochId, long generation, int timeoutMs, long waitedMs, bool timedOut, long tVirtualMs);
    void DomMapStarted(string pageEpochId, long generation, string path, long tVirtualMs);
    void DomMapCompleted(
        string pageEpochId,
        long generation,
        string path,
        long durationMs,
        int? approxNodes,
        long tVirtualMs,
        long takeRecordsMs = 0,
        long clearLedgerMs = 0,
        long anchorAllMs = 0,
        long remintMs = 0,
        long mapNodeMs = 0,
        long resetPublishedMs = 0,
        long cssomMs = 0,
        long pageTotalMs = 0,
        long cdpTransferMs = 0);
    void CssomInstallStarted(string pageEpochId, long generation, string source, long tVirtualMs);
    void CssomInstallCompleted(
        string pageEpochId,
        long generation,
        string source,
        long durationMs,
        int sheetCount,
        int ruleCount,
        int seededSheetCount,
        long tVirtualMs);
    void FirstDiffEmitted(
        string pageEpochId,
        long generation,
        string plane,
        string operation,
        long sequence,
        long? tSinceCommitMs,
        long tVirtualMs);
    void EstablishCompleted(string pageEpochId, long generation, long totalMs, long? tSinceCommitMs, long tVirtualMs);
    void EstablishFailed(string pageEpochId, long generation, string errorCode, string phase, string? message, long tVirtualMs);
}
