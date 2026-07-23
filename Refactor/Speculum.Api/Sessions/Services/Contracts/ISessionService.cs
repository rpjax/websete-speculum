using Aidan.Core.Patterns;
using Speculum.Api.Sessions.Requests;

namespace Speculum.Api.Sessions.Services.Contracts;

public interface ISessionService
{
    /// <summary>
    /// Starts a live session. Fail-fast on any provisioning step (including initial navigation).
    /// On failure, partially acquired resources are released. Returns the new session id on success.
    /// </summary>
    Task<IResult<Guid>> StartSessionAsync(
        StartSession request,
        CancellationToken ct = default);

    /// <summary>
    /// Stops a live session. Failure only when the session identity is unknown.
    /// Already-stopped is Success (idempotent). Persist is best-effort; teardown always runs.
    /// </summary>
    Task<IResult> StopSessionAsync(
        StopSession request,
        CancellationToken ct = default);
}
