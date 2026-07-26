using System.Threading.Channels;
using Aidan.Core.Patterns;
using Speculum.Api.Sessions.Models;
using Speculum.Api.Sessions.Requests;

namespace Speculum.Api.Sessions.Services.Contracts;

/// <summary>
/// Application handle for one live session: streams, commands, and permission hooks.
/// </summary>
/// <remarks>
/// Created by <see cref="ILiveSessionService.Create"/> and looked up with
/// <see cref="ILiveSessionService.TryGet"/>. One instance per live
/// sidecar connection. Presentation calls this port; it must not inject
/// <c>IBrowserClient</c> / <c>ISessionConnection</c>.
/// Stream handles are <see cref="IDisposable"/> — dispose to unregister; no close-by-id API.
/// </remarks>
public interface ILiveSession
{
    Guid SessionId { get; }

    // ── Caller attachment ────────────────────────────────────────────────────

    /// <summary>
    /// Attaches the single browser client (presence / detached timeout + command sink).
    /// Fails if a client is already attached.
    /// </summary>
    IResult<Guid> Attach(IAttachedSessionClient client);

    /// <summary>
    /// Detaches the client previously registered by <see cref="Attach"/>.
    /// Idempotent after <c>Release</c>.
    /// </summary>
    IResult Detach(Guid attachmentId);

    // ── Streams ──────────────────────────────────────────────────────────────

    /// <summary>Opens a screencast frame stream.</summary>
    IResult<IFrameStream> OpenFrameStream();

    /// <summary>Opens a console output stream.</summary>
    IResult<IConsoleOutputStream> OpenConsoleOutputStream();

    /// <summary>Opens a notification stream.</summary>
    IResult<INotificationStream> OpenNotificationStream();

    /// <summary>
    /// Pumps user input into the live session until the channel completes,
    /// <paramref name="ct"/> cancels, or the live session is released.
    /// </summary>
    IResult<Task> ConsumeUserInputAsync(
        ChannelReader<UserInput> channelReader,
        CancellationToken ct = default);

    /// <summary>
    /// Pumps console input into the live session (JsBridge-gated by mux policy).
    /// </summary>
    IResult<Task> ConsumeConsoleInputAsync(
        ChannelReader<ConsoleInput> channelReader,
        CancellationToken ct = default);

    // ── Commands ─────────────────────────────────────────────────────────────

    Task<IResult<SessionStatus>> GetStatusAsync(CancellationToken ct = default);

    Task<IResult> NavigateAsync(NavigateSession request, CancellationToken ct = default);

    Task<IResult> RefreshAsync(CancellationToken ct = default);

    Task<IResult<ResizeResult>> ResizeAsync(ResizeSession request, CancellationToken ct = default);

    Task<IResult<DiagProbeResult>> RequestDiagnosticsAsync(
        ProbeSession request,
        CancellationToken ct = default);

    // ── Hooks ────────────────────────────────────────────────────────────────

    IResult<Guid> RegisterCameraPermission(
        Func<CancellationToken, Task<PermissionDecision>> handler);

    IResult UnregisterCameraPermission(Guid registrationId);

    IResult<Guid> RegisterMicrophonePermission(
        Func<CancellationToken, Task<PermissionDecision>> handler);

    IResult UnregisterMicrophonePermission(Guid registrationId);
}
