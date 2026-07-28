using Aidan.Core.Errors;

namespace Speculum.Api.Telemetry.Events.Services.Contracts;

public interface ISessionStartTelemetryEvents
{
    void UrlResolved(string url);
    void UrlResolveFailed(Error[] errors);
}
