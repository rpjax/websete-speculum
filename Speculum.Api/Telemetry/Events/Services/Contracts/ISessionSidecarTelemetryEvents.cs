namespace Speculum.Api.Telemetry.Events.Services.Contracts;

public interface ISessionSidecarTelemetryEvents
{
    void SessionAllocated(string? inputBackend);
    void SessionReleased(string? reason);
    void DisplayAllocated(int? displayWidth, int? displayHeight, int? logicalWidth, int? logicalHeight, string? inputBackend);
    void DisplayReleased(int? displayWidth, int? displayHeight, int? logicalWidth, int? logicalHeight, string? inputBackend, string? reason);
    void AllocationFaulted(
        int? displayWidth,
        int? displayHeight,
        int? logicalWidth,
        int? logicalHeight,
        string? inputBackend,
        string errorCode,
        string phase,
        string? reason);
}
