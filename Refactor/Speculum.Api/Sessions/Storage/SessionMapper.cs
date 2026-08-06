using Speculum.Api.Sessions.Aggregates;

namespace Speculum.Api.Sessions.Storage;

internal static class SessionMapper
{
    public static Session ToDomain(SessionRecord record)
        => Session.Reconstitute(
            record.Id,
            record.ProfileId,
            record.State,
            record.StopReason,
            record.CreatedAt,
            record.StoppedAt,
            record.AbortedAt,
            record.MirrorMode,
            record.ViewportWidth,
            record.ViewportHeight);

    public static SessionRecord ToRecord(Session session)
        => new()
        {
            Id = session.Id,
            ProfileId = session.ProfileId,
            State = session.State,
            CreatedAt = session.CreatedAt,
            StoppedAt = session.StoppedAt,
            AbortedAt = session.AbortedAt,
            StopReason = session.StopReason,
            MirrorMode = session.MirrorMode,
            ViewportWidth = session.ViewportWidth,
            ViewportHeight = session.ViewportHeight,
        };
}
