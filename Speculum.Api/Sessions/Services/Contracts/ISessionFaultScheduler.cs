using Speculum.Api.Sessions.Models;

namespace Speculum.Api.Sessions.Services.Contracts;

/// <summary>
/// Requests asynchronous session stop when the browser connection is lost or faults.
/// Decouples <see cref="ILiveSession"/> from <see cref="ISessionService"/> (avoids cycles).
/// </summary>
public interface ISessionFaultScheduler
{
    /// <summary>
    /// Schedules <see cref="ISessionService.StopSessionAsync"/> for <paramref name="sessionId"/>.
    /// Idempotent at the stop layer; callers should still gate duplicate requests.
    /// </summary>
    void RequestStop(Guid sessionId, StopReason reason);
}
