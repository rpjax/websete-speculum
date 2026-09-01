namespace Speculum.Api.Telemetry.Events.Services.Contracts;

public interface ISessionPersistTelemetryEvents
{
    void SkippedNoConnection();
    void SkippedProfileNotFound();
    void Succeeded();
}
