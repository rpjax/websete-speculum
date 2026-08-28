namespace Speculum.Api.Telemetry.Events.Services.Contracts;

/// <summary>Telemetry hops/outcomes for <c>VideoStreamingInput</c> (screencast mirror input plane).</summary>
public interface ISessionVideoStreamingInputTelemetryEvents
{
    void Applied(string kind, string? phase, string? traceId = null, long? clientTimestampMs = null);
    void Rejected(
        string? errorCode,
        string? message,
        string? phase,
        string? traceId = null,
        long? clientTimestampMs = null);
    void DataPlaneReceived(string kind, string? traceId = null, long? clientTimestampMs = null);
    void ControlReceived(string kind, string? traceId = null, long? clientTimestampMs = null);
    void SidecarPushWritten(string kind, string? phase, string? traceId = null, long? clientTimestampMs = null);
    void SidecarAdmitted(string kind, string? traceId = null, long? clientTimestampMs = null);
}
