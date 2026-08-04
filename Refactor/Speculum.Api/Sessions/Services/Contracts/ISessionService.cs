using Aidan.Core.Patterns;
using Speculum.Api.Sessions.Requests;
using Speculum.Api.Sessions.Responses;

namespace Speculum.Api.Sessions.Services.Contracts;

/// <summary>
/// Application port for session lifecycle: provision and tear down.
/// </summary>
/// <remarks>
/// Coordinates durable session state with runtime:
/// <see cref="ILiveSessionService"/> (in-memory context) and
/// <see cref="ISessionCollector"/> (detached presence timer).
/// Runtime consumption (streams, commands, hooks, Attach/Detach) is on
/// <see cref="ILiveSession"/> after a successful start.
/// </remarks>
public interface ISessionService
{
    /// <summary>
    /// Starts a live session. Fail-fast on provisioning (config, profile, connection, launch, restore).
    /// URL resolve remains synchronous; initial navigation is fire-and-forget after Live so TTFF is not blocked.
    /// On failure, partially acquired resources are released and a persisted row is marked Aborted.
    /// Success order: persist Live → <see cref="ILiveSessionService.Create"/> → watch collector → start initial nav in background.
    /// Returns session id and auth token on success.
    /// </summary>
    Task<IResult<StartSessionResponse>> StartSessionAsync(
        StartSession request,
        CancellationToken ct = default);

    /// <summary>
    /// Stops a live session. Failure only when the session identity is unknown.
    /// Already-stopped/aborted is Success (idempotent) and still runs teardown for leftovers.
    /// Persist is best-effort while the connection is open; then live Release → Unwatch →
    /// StopBrowser → Close → slot release.
    /// </summary>
    Task<IResult> StopSessionAsync(
        StopSession request,
        CancellationToken ct = default);
}
