namespace Speculum.Api.Telemetry.Events.Services.Contracts;

public interface ISessionBrowseTelemetryEvents
{
    void LocationChanged(string url);
}
