using Speculum.Api.Sessions.Models;

namespace Speculum.Api.Sessions.Aggregates;

public sealed class Session
{
    public Guid Id { get; private set; }
    public Guid ProfileId { get; private set; }
    public LifecycleState State { get; private set; }
    public string AuthToken { get; private set; }
    public DateTimeOffset CreatedAt { get; private set; }
    public DateTimeOffset? StoppedAt { get; private set; }
    public DateTimeOffset? AbortedAt { get; private set; }
    public StopReason? StopReason { get; private set; }

    internal Session(
        Guid id,
        Guid profileId,
        LifecycleState state,
        string authToken,
        DateTimeOffset createdAt,
        DateTimeOffset? stoppedAt,
        DateTimeOffset? abortedAt,
        StopReason? stopReason = null)
    {
        Id = id;
        ProfileId = profileId;
        State = state;
        AuthToken = authToken;
        CreatedAt = createdAt;
        StoppedAt = stoppedAt;
        AbortedAt = abortedAt;
        StopReason = stopReason;
    }

    public static Session Create(Guid id, Guid profileId, string? authToken = null)
        => new(
            id,
            profileId,
            LifecycleState.Live,
            authToken ?? string.Empty,
            DateTimeOffset.UtcNow,
            stoppedAt: null,
            abortedAt: null);

    public static Session Reconstitute(
        Guid id,
        Guid profileId,
        LifecycleState state,
        StopReason? stopReason = null)
        => new(
            id,
            profileId,
            state,
            authToken: string.Empty,
            createdAt: DateTimeOffset.UtcNow,
            stoppedAt: null,
            abortedAt: null,
            stopReason);

    public void MarkLive()
    {
        State = LifecycleState.Live;
    }

    public void MarkStopped(StopReason reason) => MarkStopped(reason, DateTimeOffset.UtcNow);

    public void MarkStopped(StopReason reason, DateTimeOffset stoppedAt)
    {
        State = LifecycleState.Stopped;
        StoppedAt = stoppedAt;
        StopReason = reason;
    }

    public void MarkAborted(StopReason reason) => MarkAborted(reason, DateTimeOffset.UtcNow);

    public void MarkAborted(StopReason reason, DateTimeOffset abortedAt)
    {
        State = LifecycleState.Aborted;
        AbortedAt = abortedAt;
        StopReason = reason;
    }
}
