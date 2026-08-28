using Speculum.Api.Configurations.Models.Sessions;
using Speculum.Api.Sessions.Models;

namespace Speculum.Api.Sessions.Responses;

/// <summary>
/// List/detail projection over the durable session row. Live-only ephemeral fields
/// (connectionOpen, uptimeMs, jsBridgeEnabled) are not stored here — the endpoint merges
/// those in from <see cref="Speculum.Api.Sessions.Services.Contracts.ILiveSessionService"/>
/// when <see cref="State"/> is Live.
/// </summary>
public sealed class SessionListItem
{
    public Guid SessionId { get; init; }
    public Guid ProfileId { get; init; }
    public LifecycleState State { get; init; }
    public DateTimeOffset StartedAt { get; init; }
    public DateTimeOffset? EndedAt { get; init; }
    public string? EndReason { get; init; }
    public MirrorMode? MirrorMode { get; init; }
    public int? ViewportWidth { get; init; }
    public int? ViewportHeight { get; init; }
}
