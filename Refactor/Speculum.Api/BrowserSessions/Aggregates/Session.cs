using Speculum.Api.BrowserSessions.Models;

namespace Speculum.Api.BrowserSessions.Aggregates;

public sealed class Session
{
    public Guid Id { get; private set; }
    public Guid ProfileId { get; private set; }
    public LifecycleState State { get; private set; }

    public static Session Create(Guid id, Guid profileId)
        => new()
        {
            Id = id,
            ProfileId = profileId,
            State = LifecycleState.Live,
        };

    internal static Session Reconstitute(Guid id, Guid profileId, LifecycleState state)
        => new()
        {
            Id = id,
            ProfileId = profileId,
            State = state,
        };

    public void MarkStopped()
        => State = LifecycleState.Stopped;
}
