using Speculum.Api.Journal.Services.Contracts;
using Speculum.Api.Sessions.Aggregates;
using Speculum.Api.Sessions.Events.Services.Contracts;

namespace Speculum.Api.Sessions.Events.Services;

public sealed class SessionEventsFactory : ISessionEventsFactory
{
    private readonly IJournalWriter _writer;

    public SessionEventsFactory(IJournalWriter writer)
    {
        _writer = writer ?? throw new ArgumentNullException(nameof(writer));
    }

    public ISessionLifecycleEvents ForSessionLifecycle(Guid sessionId, Guid profileId)
        => new SessionLifecycleEvents(_writer, sessionId, profileId);

    public ISessionStartEvents ForSessionStart(Guid sessionId, Guid profileId)
        => new SessionStartEvents(_writer, sessionId, profileId);

    public ISessionStopEvents ForSessionStop(Guid sessionId, Guid profileId)
        => new SessionStopEvents(_writer, sessionId, profileId);

    public ISessionLifecycleEvents ForSessionLifecycle(Session session)
    {
        ArgumentNullException.ThrowIfNull(session);
        return ForSessionLifecycle(session.Id, session.ProfileId);
    }

    public ISessionStartEvents ForSessionStart(Session session)
    {
        ArgumentNullException.ThrowIfNull(session);
        return ForSessionStart(session.Id, session.ProfileId);
    }

    public ISessionStopEvents ForSessionStop(Session session)
    {
        ArgumentNullException.ThrowIfNull(session);
        return ForSessionStop(session.Id, session.ProfileId);
    }
}
