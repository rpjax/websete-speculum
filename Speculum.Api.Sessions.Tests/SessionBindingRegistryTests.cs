using System.Diagnostics.CodeAnalysis;
using System.Threading.Channels;
using Aidan.Core.Patterns;
using Speculum.Api.BrowserClients;
using Speculum.Api.Configurations.Models.Sessions;
using Speculum.Api.Sessions.Mirror.PageProjection;
using Speculum.Api.Sessions.Models;
using Speculum.Api.Sessions.Requests;
using Speculum.Api.Sessions.Services;
using Speculum.Api.Sessions.Services.Contracts;
using Speculum.Api.Sessions.Services.Streaming;

namespace Speculum.Api.Sessions.Tests;

public sealed class SessionBindingRegistryTests
{
    [Fact]
    public async Task BeginStart_CancelsPriorStart_AndCompletesItsWaiter()
    {
        var registry = new SessionBindingRegistry(new FakeLiveSessionService());
        var firstId = Guid.NewGuid();
        var first = registry.BeginStart("caller", firstId);

        var second = registry.BeginStart("caller", Guid.NewGuid());

        Assert.True(first.CancellationToken.IsCancellationRequested);
        Assert.True(second.PreviousStartCompletion.IsCompleted);
        await second.PreviousStartCompletion;
    }

    [Fact]
    public void CancelAllStarts_CancelsInFlightStarts_LeavesLiveBindings()
    {
        var liveSessionId = Guid.NewGuid();
        var live = new FakeLiveSession(liveSessionId);
        var registry = new SessionBindingRegistry(new FakeLiveSessionService(live));

        var startA = registry.BeginStart("caller-a", Guid.NewGuid());
        var startB = registry.BeginStart("caller-b", Guid.NewGuid());
        registry.BeginStart("caller-live", liveSessionId);
        Assert.True(registry.TryPromote(
            "caller-live",
            liveSessionId,
            Guid.NewGuid(),
            "token"));

        var cancelled = registry.CancelAllStarts();

        Assert.Equal(2, cancelled);
        Assert.True(startA.CancellationToken.IsCancellationRequested);
        Assert.True(startB.CancellationToken.IsCancellationRequested);
        Assert.True(registry.TryGetLive(liveSessionId, "token", out _));
        Assert.Equal(0, registry.CancelAllStarts());
    }

    [Fact]
    public void CloseCaller_DisposesCarriers_AndDetachesPresence()
    {
        var sessionId = Guid.NewGuid();
        var live = new FakeLiveSession(sessionId);
        var service = new FakeLiveSessionService(live);
        var registry = new SessionBindingRegistry(service);
        registry.BeginStart("caller", sessionId);
        Assert.True(registry.TryPromote(
            "caller",
            sessionId,
            Guid.Parse("00000000-0000-0000-0000-000000000123"),
            "token"));
        var carrier = new RecordingDisposable();
        Assert.True(registry.RegisterCarrier(
            sessionId,
            "token",
            Guid.NewGuid(),
            carrier).IsSuccess);

        registry.CloseCaller("caller");

        Assert.True(carrier.IsDisposed);
        Assert.Equal(
            Guid.Parse("00000000-0000-0000-0000-000000000123"),
            live.DetachedAttachmentId);
        Assert.False(registry.TryGetLive(sessionId, "token", out _));
    }

    [Fact]
    public void CloseCaller_ReturnsLiveSessionId_WhenPromoted()
    {
        var sessionId = Guid.NewGuid();
        var live = new FakeLiveSession(sessionId);
        var registry = new SessionBindingRegistry(new FakeLiveSessionService(live));
        registry.BeginStart("caller", sessionId);
        Assert.True(registry.TryPromote(
            "caller",
            sessionId,
            Guid.NewGuid(),
            "token"));

        var closed = registry.CloseCaller("caller");

        Assert.Equal(sessionId, closed);
        Assert.NotNull(live.DetachedAttachmentId);
    }

    [Fact]
    public void CloseCaller_ReturnsNull_WhenStartNotPromoted()
    {
        var registry = new SessionBindingRegistry(new FakeLiveSessionService());
        registry.BeginStart("caller", Guid.NewGuid());

        Assert.Null(registry.CloseCaller("caller"));
    }

    [Fact]
    public void WebTransportCarrier_OpenClose_RegistersAndClearsOwnership()
    {
        var sessionId = Guid.NewGuid();
        var live = new FakeLiveSession(sessionId);
        var registry = new SessionBindingRegistry(new FakeLiveSessionService(live));
        registry.BeginStart("caller", sessionId);
        Assert.True(registry.TryPromote(
            "caller",
            sessionId,
            Guid.NewGuid(),
            "token"));
        var carrierId = Guid.NewGuid();
        var carrier = new RecordingDisposable();

        Assert.True(registry.RegisterCarrier(sessionId, "token", carrierId, carrier).IsSuccess);
        registry.UnregisterCarrier(carrierId);

        Assert.True(carrier.IsDisposed);
        Assert.True(registry.TryGetLive(sessionId, "token", out _));
    }

    private sealed class RecordingDisposable : IDisposable
    {
        public bool IsDisposed { get; private set; }

        public void Dispose() => IsDisposed = true;
    }

    private sealed class FakeLiveSessionService : ILiveSessionService
    {
        private readonly ILiveSession? _session;

        public FakeLiveSessionService(ILiveSession? session = null)
        {
            _session = session;
        }

        public IResult<ILiveSession> Create(
            Guid sessionId,
            Guid profileId,
            ISessionConnection connection,
            string requestHost,
            bool jsBridgeEnabled)
            => throw new NotSupportedException();

        public bool TryGet(
            Guid sessionId,
            [NotNullWhen(true)] out ILiveSession? session)
        {
            session = _session?.SessionId == sessionId ? _session : null;
            return session is not null;
        }

        public IReadOnlyList<LiveSessionTelemetrySnapshot> ListSnapshots() => [];

        public void Release(Guid sessionId)
        {
        }
    }

    private sealed class FakeLiveSession : ILiveSession
    {
        public FakeLiveSession(Guid sessionId)
        {
            SessionId = sessionId;
        }

        public Guid SessionId { get; }
        public MirrorMode MirrorMode => Configurations.Models.Sessions.MirrorMode.VideoStreaming;
        public Guid? DetachedAttachmentId { get; private set; }

        public IResult<Guid> Attach(IAttachedSessionClient client)
            => Result<Guid>.Success(Guid.NewGuid());

        public IResult Detach(Guid attachmentId)
        {
            DetachedAttachmentId = attachmentId;
            return Result.Success();
        }

        public IResult ObserveSessionNotifications(INotificationStream stream)
            => Result.Success();

        public IResult<IFrameStream> OpenFrameStream(Guid consumerId) => throw new NotSupportedException();
        public IResult<IPageProjectionFramesStream> OpenPageProjectionFramesStream(Guid consumerId) => throw new NotSupportedException();
        public IResult<IConsoleOutputStream> OpenConsoleOutputStream(Guid consumerId) => throw new NotSupportedException();
        public IResult<INotificationStream> OpenNotificationStream(Guid consumerId) => throw new NotSupportedException();

        public IResult<Task> ConsumeVideoStreamingInputAsync(
            Guid consumerId,
            ChannelReader<VideoStreamingInput> channelReader,
            CancellationToken ct = default)
            => throw new NotSupportedException();

        public IResult AdmitVideoStreamingInput(VideoStreamingInput input) => Result.Success();

        public IResult AdmitPageProjectionInput(PageProjectionIntent input)
            => Result.Success();

        public IResult<Task> ConsumeConsoleInputAsync(
            Guid consumerId,
            ChannelReader<ConsoleInput> channelReader,
            CancellationToken ct = default)
            => throw new NotSupportedException();

        public void TraceVideoStreamingInputDataPlaneReceived(
            string kind,
            string? traceId = null,
            long? clientTimestampMs = null) { }

        public void TraceVideoStreamingInputControlReceived(
            string kind,
            string? traceId = null,
            long? clientTimestampMs = null) { }

        public void TracePageProjectionIntentDataPlaneReceived(
            string kind,
            long? generation,
            string? anchor,
            string? traceId = null,
            long? clientTimestampMs = null) { }

        public void TracePageProjectionFrameWireDelivered(
            PageProjectionFrame diff,
            long durationMs = 0,
            Guid streamId = default,
            Guid consumerId = default,
            long frameEpoch = 0) { }

        public void TracePageProjectionFrameFanOutEnqueued(
            PageProjectionFrame diff,
            long waitMs,
            Guid streamId,
            Guid consumerId,
            string kind,
            int targetIndex,
            int targetCount,
            int frameChannelCount,
            long frameEpoch) { }

        public void TracePageProjectionFrameStreamDequeued(
            PageProjectionFrame diff,
            Guid streamId = default,
            Guid consumerId = default,
            long frameEpoch = 0) { }

        public bool IsPageProjectionFrameWireDeliveredEnabled() => false;

        public void TracePageProjectionFrameReceived(PageProjectionFrame diff) { }

        public void TracePageProjectionFrameQueueDropped(
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
            int? frameChannelCount = null,
            long? frameEpoch = null) { }

        public void ReportPageProjectionFrameQueueDropped(
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
            int? frameChannelCount = null,
            long? frameEpoch = null) { }

        public int GetPageProjectionFrameConnectionQueueDepth() => 0;

        public ulong GetPageProjectionFrameConnectionQueuedBytes() => 0;

        public ulong GetPageProjectionFrameOldestQueuedMs() => 0;

        public void NotifyPageProjectionFrameConnectionDequeued() { }

        public void TrySendConsumerPressure(ConsumerPressureSnapshot snapshot) { }

        public Task<IResult<SessionStatus>> GetStatusAsync(CancellationToken ct = default)
            => throw new NotSupportedException();

        public Task<IResult<NavigateResult>> NavigateAsync(
            NavigateSession request,
            CancellationToken ct = default)
            => throw new NotSupportedException();

        public Task<IResult> NavigateToAbsoluteUrlAsync(string url, CancellationToken ct = default)
            => throw new NotSupportedException();

        public Task<IResult> RefreshAsync(CancellationToken ct = default)
            => throw new NotSupportedException();

        public Task<IResult<ResizeResult>> ResizeAsync(
            ResizeSession request,
            CancellationToken ct = default)
            => throw new NotSupportedException();

        public Task<IResult<DiagProbeResult>> RequestDiagnosticsAsync(
            ProbeSession request,
            CancellationToken ct = default)
            => throw new NotSupportedException();

        public Task<IResult<VirtualResourceResponse>> GetVirtualAssetAsync(
            string key,
            CancellationToken ct = default,
            string? kind = null,
            string? rangeHeader = null)
            => throw new NotSupportedException();

        public Task<IResult> RequestResyncAsync(uint contextId = 1, string? reason = null, CancellationToken ct = default)
            => Task.FromResult<IResult>(Result.Success());
        public Task<IResult> PutDomUploadAsync(
            string uploadId,
            byte[] body,
            string contentType,
            string name,
            CancellationToken ct = default)
            => Task.FromResult<IResult>(Result.Success());

        public IResult<Guid> RegisterCameraPermission(
            Func<CancellationToken, Task<PermissionDecision>> handler)
            => Result<Guid>.Failure("not implemented");

        public IResult UnregisterCameraPermission(Guid registrationId)
            => Result.Failure("not implemented");

        public IResult<Guid> RegisterMicrophonePermission(
            Func<CancellationToken, Task<PermissionDecision>> handler)
            => Result<Guid>.Failure("not implemented");

        public IResult UnregisterMicrophonePermission(Guid registrationId)
            => Result.Failure("not implemented");

    }
}
