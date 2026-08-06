namespace Speculum.Api.Telemetry.Events.Services.Contracts;

/// <summary>Telemetry hops/outcomes for Dom Projection element input (Projected → Virtual).</summary>
public interface ISessionDomProjectionInputTelemetryEvents
{
    void DataPlaneReceived(
        string kind,
        long? generation,
        string? anchor,
        string? traceId = null,
        long? clientTimestampMs = null);

    void AdmissionDropped(
        string kind,
        long? generation,
        string? anchor,
        string? traceId = null,
        long? clientTimestampMs = null);

    void SidecarPushWritten(
        string kind,
        string? phase,
        long? generation,
        string? anchor,
        string? traceId = null,
        long? clientTimestampMs = null);

    void SidecarAdmitted(
        string kind,
        long? generation,
        string? anchor,
        string? traceId = null,
        long? clientTimestampMs = null);

    void CdpDropped(
        string kind,
        string? reason,
        long? generation,
        string? anchor,
        string? traceId = null,
        long? clientTimestampMs = null);

    void Applied(
        string kind,
        string? phase,
        long? generation,
        string? anchor,
        string? traceId = null,
        long? clientTimestampMs = null);

    void Rejected(
        string? errorCode,
        string? message,
        string? phase,
        long? generation,
        string? anchor,
        string? traceId = null,
        long? clientTimestampMs = null);
}
