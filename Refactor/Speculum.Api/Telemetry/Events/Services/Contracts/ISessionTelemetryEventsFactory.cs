namespace Speculum.Api.Telemetry.Events.Services.Contracts;

public interface ISessionTelemetryEventsFactory
{
    ISessionTelemetryEvents ForSession(Guid sessionId, Guid profileId);
}
