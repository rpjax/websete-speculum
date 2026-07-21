using Speculum.Api.BrowserSessions.Aggregates;

namespace Speculum.Api.BrowserSessions.Storage;

internal static class SessionMapper
{
    public static Session ToDomain(SessionRecord record)
        => Session.Reconstitute(record.Id, record.ProfileId, record.State);

    public static SessionRecord ToRecord(Session session)
        => new()
        {
            Id = session.Id,
            ProfileId = session.ProfileId,
            State = session.State,
        };
}
