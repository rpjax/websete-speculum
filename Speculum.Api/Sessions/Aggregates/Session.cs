using Speculum.Api.Configurations.Models.Sessions;
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

    /// <summary>Mirror surface resolved at Start (engine config at the time); null for pre-migration rows.</summary>
    public MirrorMode? MirrorMode { get; private set; }

    /// <summary>Start-requested viewport (client-measured geometry); null for pre-migration rows.</summary>
    public int? ViewportWidth { get; private set; }
    public int? ViewportHeight { get; private set; }

    /// <summary>Stopped or Aborted timestamp, whichever applies; null while Live.</summary>
    public DateTimeOffset? EndedAt => StoppedAt ?? AbortedAt;

    internal Session(
        Guid id,
        Guid profileId,
        LifecycleState state,
        string authToken,
        DateTimeOffset createdAt,
        DateTimeOffset? stoppedAt,
        DateTimeOffset? abortedAt,
        StopReason? stopReason = null,
        MirrorMode? mirrorMode = null,
        int? viewportWidth = null,
        int? viewportHeight = null)
    {
        Id = id;
        ProfileId = profileId;
        State = state;
        AuthToken = authToken;
        CreatedAt = createdAt;
        StoppedAt = stoppedAt;
        AbortedAt = abortedAt;
        StopReason = stopReason;
        MirrorMode = mirrorMode;
        ViewportWidth = viewportWidth;
        ViewportHeight = viewportHeight;
    }

    public static Session Create(
        Guid id,
        Guid profileId,
        string? authToken = null,
        MirrorMode? mirrorMode = null,
        int? viewportWidth = null,
        int? viewportHeight = null)
        => new(
            id,
            profileId,
            LifecycleState.Live,
            authToken ?? string.Empty,
            DateTimeOffset.UtcNow,
            stoppedAt: null,
            abortedAt: null,
            stopReason: null,
            mirrorMode: mirrorMode,
            viewportWidth: viewportWidth,
            viewportHeight: viewportHeight);

    /// <summary>Rebuilds an aggregate from durable storage. All lifecycle timestamps are optional
    /// so pre-migration rows (created before these columns existed) still load.</summary>
    public static Session Reconstitute(
        Guid id,
        Guid profileId,
        LifecycleState state,
        StopReason? stopReason = null,
        DateTimeOffset? createdAt = null,
        DateTimeOffset? stoppedAt = null,
        DateTimeOffset? abortedAt = null,
        MirrorMode? mirrorMode = null,
        int? viewportWidth = null,
        int? viewportHeight = null)
        => new(
            id,
            profileId,
            state,
            authToken: string.Empty,
            createdAt: createdAt ?? DateTimeOffset.UtcNow,
            stoppedAt: stoppedAt,
            abortedAt: abortedAt,
            stopReason,
            mirrorMode,
            viewportWidth,
            viewportHeight);

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
