namespace Speculum.Api.Telemetry.Ports;

public interface ISessionTelemetrySampleSource
{
    IReadOnlyList<SessionTelemetryLiveSnapshot> ListSnapshots();

    Task<SessionTelemetryLiveStatus?> TryGetStatusAsync(Guid sessionId, CancellationToken ct);

    int GetConfiguredCapacityMax();
}
