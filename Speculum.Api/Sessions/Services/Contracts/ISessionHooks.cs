using Aidan.Core.Patterns;
using Speculum.Api.Sessions.Models;

namespace Speculum.Api.Sessions.Services.Contracts;

/// <summary>
/// Per-connection hook multiplexor for sidecar-awaited permission RPCs.
/// Owned by <see cref="ILiveSession"/>; application registers via the live-session handle.
/// </summary>
/// <remarks>
/// Installs its own handlers on <c>ISessionConnection</c>. Fail-closed multiplex:
/// no registrants or any Deny/fault → Deny; Allow only when every registrant returns Allow.
/// </remarks>
public interface ISessionHooks
{
    Guid SessionId { get; }

    IResult<Guid> RegisterCameraPermission(
        Func<CancellationToken, Task<PermissionDecision>> handler);

    IResult UnregisterCameraPermission(Guid registrationId);

    IResult<Guid> RegisterMicrophonePermission(
        Func<CancellationToken, Task<PermissionDecision>> handler);

    IResult UnregisterMicrophonePermission(Guid registrationId);
}
