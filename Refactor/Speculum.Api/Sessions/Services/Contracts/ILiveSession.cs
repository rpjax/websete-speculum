using System.Threading.Channels;
using Aidan.Core.Patterns;
using Speculum.Api.Configurations.Models.Sessions;
using Speculum.Api.Sessions.Mirror.DomProjection;
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
/// Visual and input streams are MirrorMode-gated: VideoStreaming uses frame + coordinate
/// input; DomProjection uses DomDiff + element input.
/// </remarks>
public interface ILiveSession
{
    Guid SessionId { get; }

    /// <summary>
    /// Sessions.MirrorMode captured at create (admin engine config). Immutable for this live.
    /// </summary>
    MirrorMode MirrorMode { get; }

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

    /// <summary>Opens a screencast frame stream (MirrorMode.VideoStreaming only).</summary>
    IResult<IFrameStream> OpenFrameStream();

    /// <summary>Opens a Dom Projection diff stream (MirrorMode.DomProjection only).</summary>
    IResult<IDomDiffStream> OpenDomDiffStream();

    /// <summary>Opens a console output stream.</summary>
    IResult<IConsoleOutputStream> OpenConsoleOutputStream();

    /// <summary>Opens a notification stream.</summary>
    IResult<INotificationStream> OpenNotificationStream();

    /// <summary>
    /// Pumps video-streaming input until the channel completes,
    /// <paramref name="ct"/> cancels, or the live session is released.
    /// Prefer <see cref="AdmitVideoStreamingInput"/> for the product path (shared admission).
    /// MirrorMode.VideoStreaming only.
    /// </summary>
    IResult<Task> ConsumeVideoStreamingInputAsync(
        ChannelReader<VideoStreamingInput> channelReader,
        CancellationToken ct = default);

    /// <summary>
    /// Ensures a single DropOldest admission pump and enqueues one video-streaming input event.
    /// Product path: data-plane VideoStreamingInput stream; harness HTTP may also admit.
    /// MirrorMode.VideoStreaming only.
    /// </summary>
    IResult AdmitVideoStreamingInput(VideoStreamingInput input);

    /// <summary>
    /// Admits one Dom Projection input event. MirrorMode.DomProjection only.
    /// </summary>
    IResult AdmitDomProjectionInput(DomProjectionInput input);

    /// <summary>
    /// Pumps console input into the live session (JsBridge-gated by mux policy).
    /// </summary>
    IResult<Task> ConsumeConsoleInputAsync(
        ChannelReader<ConsoleInput> channelReader,
        CancellationToken ct = default);

    /// <summary>
    /// Opt-in Journal hop: VideoStreamingInput framed message on the data plane.
    /// No-op when <c>Telemetry.Sessions.VideoStreamingInput.DataPlaneReceived</c> is disabled.
    /// </summary>
    void TraceVideoStreamingInputDataPlaneReceived(
        string kind,
        string? traceId = null,
        long? clientTimestampMs = null);

    /// <summary>
    /// Opt-in Journal hop: VideoStreamingInput admitted outside the framed data plane (e.g. harness).
    /// No-op when <c>Telemetry.Sessions.VideoStreamingInput.ControlReceived</c> is disabled.
    /// </summary>
    void TraceVideoStreamingInputControlReceived(
        string kind,
        string? traceId = null,
        long? clientTimestampMs = null);

    /// <summary>
    /// Opt-in Journal hop: DomProjectionInput framed message on the data plane.
    /// No-op when <c>Telemetry.Sessions.DomProjection.Input.DataPlaneReceived</c> is disabled.
    /// </summary>
    void TraceDomProjectionInputDataPlaneReceived(
        string kind,
        long? generation,
        string? anchor,
        string? traceId = null,
        long? clientTimestampMs = null);

    // ── Commands ─────────────────────────────────────────────────────────────

    Task<IResult<SessionStatus>> GetStatusAsync(CancellationToken ct = default);

    Task<IResult<NavigateResult>> NavigateAsync(NavigateSession request, CancellationToken ct = default);

    /// <summary>
    /// Absolute-URL navigate under the command gate without NavigateRequested journal.
    /// Used for fire-and-forget initial navigation after the session is Live.
    /// </summary>
    Task<IResult> NavigateToAbsoluteUrlAsync(string url, CancellationToken ct = default);

    Task<IResult> RefreshAsync(CancellationToken ct = default);

    Task<IResult<ResizeResult>> ResizeAsync(ResizeSession request, CancellationToken ct = default);

    Task<IResult<DiagProbeResult>> RequestDiagnosticsAsync(
        ProbeSession request,
        CancellationToken ct = default);

    /// <summary>
    /// Fetches a Dom Projection asset by hash (MirrorMode.DomProjection only).
    /// </summary>
    Task<IResult<DomAsset>> GetDomAssetAsync(
        string key,
        CancellationToken ct = default,
        string? kind = null,
        string? rangeHeader = null);

    Task<IResult> PutDomUploadAsync(
        string uploadId,
        byte[] body,
        string contentType,
        string name,
        CancellationToken ct = default);

    // ── Hooks ────────────────────────────────────────────────────────────────

    IResult<Guid> RegisterCameraPermission(
        Func<CancellationToken, Task<PermissionDecision>> handler);

    IResult UnregisterCameraPermission(Guid registrationId);

    IResult<Guid> RegisterMicrophonePermission(
        Func<CancellationToken, Task<PermissionDecision>> handler);

    IResult UnregisterMicrophonePermission(Guid registrationId);
}
