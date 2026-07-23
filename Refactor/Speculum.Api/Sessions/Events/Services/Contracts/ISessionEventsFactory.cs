using Speculum.Api.Sessions.Aggregates;

namespace Speculum.Api.Sessions.Events.Services.Contracts;

public interface ISessionEventsFactory
{
    ISessionLifecycleEvents ForSessionLifecycle(Guid sessionId, Guid profileId);
    ISessionStartEvents ForSessionStart(Guid sessionId, Guid profileId);
    ISessionStopEvents ForSessionStop(Guid sessionId, Guid profileId);

    ISessionLifecycleEvents ForSessionLifecycle(Session session);
    ISessionStartEvents ForSessionStart(Session session);
    ISessionStopEvents ForSessionStop(Session session);
}
