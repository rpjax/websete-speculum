namespace Speculum.Api.Telemetry.Events.Services.Contracts;

public interface ISessionCapacityTelemetryEvents
{
    void SlotAcquired();
    void SlotReleased();
    void NoSlotAvailable();
}
