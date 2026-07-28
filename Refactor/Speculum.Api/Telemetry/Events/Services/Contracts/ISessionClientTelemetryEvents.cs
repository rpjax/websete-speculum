namespace Speculum.Api.Telemetry.Events.Services.Contracts;

public interface ISessionClientTelemetryEvents
{
    void AttachedCommandFailed(string command, Exception exception);
}
