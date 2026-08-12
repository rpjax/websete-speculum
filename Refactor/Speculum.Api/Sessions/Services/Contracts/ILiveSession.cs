using System.Threading.Channels;
using Aidan.Core.Patterns;
using Speculum.Api.Configurations.Models.Sessions;
using Speculum.Api.Sessions.Mirror.PageProjection;
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
/// input; PageProjection uses PageProjectionDiff + element input.
/// Attachment id is the consumer id for output streams and input pumps.
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
    /// Fails if a client is already attached. Returns the consumer id (attachment id).
    /// Does not open streams — call <see cref="OpenNotificationStream"/> +
    /// <see cref="ObserveSessionNotifications"/> for the feature notification loop.
    /// </summary>
    IResult<Guid> Attach(IAttachedSessionClient client);

    /// <summary>
    /// Detaches the client previously registered by <see cref="Attach"/>.
    /// Idempotent after <c>Release</c>.
    /// </summary>
    IResult Detach(Guid attachmentId);

    /// <summary>
    /// Takes ownership of a notification stream and runs the session feature loop
    /// (SyncUrl, crash → abandon, journal hops). Disposes the stream on Release.
    /// </summary>
    IResult ObserveSessionNotifications(INotificationStream stream);

    // ── Streams ──────────────────────────────────────────────────────────────

    /// <summary>Opens a screencast frame stream (MirrorMode.VideoStreaming only).</summary>
    IResult<IFrameStream> OpenFrameStream(Guid consumerId);

    /// <summary>Opens a Dom Projection diff stream (MirrorMode.PageProjection only).</summary>
    IResult<IPageProjectionDiffStream> OpenPageProjectionDiffStream(Guid consumerId);

    /// <summary>Opens a console output stream.</summary>
    IResult<IConsoleOutputStream> OpenConsoleOutputStream(Guid consumerId);

    /// <summary>Opens a notification stream.</summary>
    IResult<INotificationStream> OpenNotificationStream(Guid consumerId);

    /// <summary>
    /// Pumps video-streaming input until the channel completes,
    /// <paramref name="ct"/> cancels, or the live session is released.
    /// Prefer <see cref="AdmitVideoStreamingInput"/> for the product path (shared admission).
    /// MirrorMode.VideoStreaming only.
    /// </summary>
    IResult<Task> ConsumeVideoStreamingInputAsync(
        Guid consumerId,
        ChannelReader<VideoStreamingInput> channelReader,
        CancellationToken ct = default);

    /// <summary>
    /// Ensures a single DropOldest admission pump and enqueues one video-streaming input event.
    /// Product path: data-plane VideoStreamingInput stream; harness HTTP may also admit.
    /// MirrorMode.VideoStreaming only.
    /// </summary>
    IResult AdmitVideoStreamingInput(VideoStreamingInput input);

    /// <summary>
    /// Admits one Dom Projection input event. MirrorMode.PageProjection only.
    /// </summary>
    IResult AdmitPageProjectionInput(PageProjectionIntent input);

    /// <summary>
    /// Pumps console input into the live session (JsBridge-gated by mux policy).
    /// </summary>
    IResult<Task> ConsumeConsoleInputAsync(
        Guid consumerId,
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
    /// Opt-in Journal hop: PageProjectionIntent framed message on the data plane.
    /// No-op when <c>Telemetry.Sessions.PageProjection.Input.DataPlaneReceived</c> is disabled.
    /// </summary>
    void TracePageProjectionIntentDataPlaneReceived(
        string kind,
        long? generation,
        string? anchor,
        string? traceId = null,
        long? clientTimestampMs = null);

    /// <summary>
    /// Opt-in Journal hop: Diff written to the client data-plane stream.
    /// No-op when <c>Telemetry.Sessions.PageProjection.Diff.WireDelivered</c> is disabled.
    /// </summary>
    void TracePageProjectionDiffWireDelivered(
        PageProjectionDiff diff,
        long durationMs = 0,
        Guid streamId = default,
        Guid consumerId = default,
        long diffEpoch = 0);

    /// <summary>
    /// Opt-in Journal hop: Diff accepted into the per-stream fan-out channel.
    /// No-op when <c>Telemetry.Sessions.PageProjection.Diff.FanOutEnqueued</c> is disabled.
    /// </summary>
    void TracePageProjectionDiffFanOutEnqueued(
        PageProjectionDiff diff,
        long waitMs,
        Guid streamId,
        Guid consumerId,
        string kind,
        int targetIndex,
        int targetCount,
        int diffChannelCount,
        long diffEpoch);

    /// <summary>
    /// Opt-in Journal hop: hub Diff pump dequeued a frame before stream write.
    /// No-op when <c>Telemetry.Sessions.PageProjection.Diff.StreamDequeued</c> is disabled.
    /// </summary>
    void TracePageProjectionDiffStreamDequeued(
        PageProjectionDiff diff,
        Guid streamId = default,
        Guid consumerId = default,
        long diffEpoch = 0);

    /// <summary>
    /// True when <c>Telemetry.Sessions.PageProjection.Diff.WireDelivered</c> is catalog-enabled
    /// (callers may skip Stopwatch when false).
    /// </summary>
    bool IsPageProjectionDiffWireDeliveredEnabled();

    /// <summary>
    /// Opt-in Journal hop: Diff frame received from sidecar (before connection enqueue).
    /// No-op when <c>Telemetry.Sessions.PageProjection.Diff.FrameReceived</c> is disabled.
    /// Journaled directly — not via the DropOldest notification channel.
    /// </summary>
    void TracePageProjectionDiffFrameReceived(PageProjectionDiff diff);

    /// <summary>
    /// Opt-in Journal hop: sequenced Diff queue drop at a named stage.
    /// No-op when <c>Telemetry.Sessions.PageProjection.Diff.QueueDropped</c> is disabled.
    /// Journaled directly — not via the DropOldest notification channel.
    /// </summary>
    void TracePageProjectionDiffQueueDropped(
        string stage,
        int droppedCount,
        int capacity,
        long? sequence = null,
        long? generation = null,
        string? plane = null,
        string? operation = null,
        long? lowestDroppedSequence = null,
        long? highestDroppedSequence = null,
        string? reason = null,
        Guid? streamId = null,
        Guid? consumerId = null,
        string? kind = null,
        int? targetCount = null,
        int? diffChannelCount = null,
        long? diffEpoch = null);

    /// <summary>
    /// Chronology-breaking Diff queue drop: journals (when enabled) and publishes
    /// client-visible <c>PageProjectionLifecycle phase=queue_dropped</c> for T8 recovery.
    /// </summary>
    void ReportPageProjectionDiffQueueDropped(
        string stage,
        int droppedCount,
        int capacity,
        long? sequence = null,
        long? generation = null,
        string? plane = null,
        string? operation = null,
        long? lowestDroppedSequence = null,
        long? highestDroppedSequence = null,
        string? reason = null,
        Guid? streamId = null,
        Guid? consumerId = null,
        string? kind = null,
        int? targetCount = null,
        int? diffChannelCount = null,
        long? diffEpoch = null);

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
    /// Fetches a Dom Projection asset by hash (MirrorMode.PageProjection only).
    /// </summary>
    Task<IResult<DomAsset>> GetDomAssetAsync(
        string key,
        CancellationToken ct = default,
        string? kind = null,
        string? rangeHeader = null);

    /// <summary>OOB PageProjection.Resync (MirrorMode.PageProjection only).</summary>
    Task<IResult<PageProjectionResyncSnapshot>> GetPageProjectionResyncAsync(
        long generation,
        long sequence,
        CancellationToken ct = default);

    Task<IResult> PutDomUploadAsync(
        string uploadId,
        byte[] body,
        string contentType,
        string name,
        CancellationToken ct = default);

    /// <summary>
    /// Client → server control channel (§5.9.5, MirrorMode.PageProjection only). A control
    /// report, not a diff — never advances the live `sequence`.
    /// </summary>
    Task<IResult> ReportPageProjectionClientStateAsync(
        PageProjectionClientStateReport report,
        CancellationToken ct = default);

    // ── Hooks ────────────────────────────────────────────────────────────────

    IResult<Guid> RegisterCameraPermission(
        Func<CancellationToken, Task<PermissionDecision>> handler);

    IResult UnregisterCameraPermission(Guid registrationId);

    IResult<Guid> RegisterMicrophonePermission(
        Func<CancellationToken, Task<PermissionDecision>> handler);

    IResult UnregisterMicrophonePermission(Guid registrationId);
}
