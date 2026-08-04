using System.Diagnostics.CodeAnalysis;
using System.Threading.Channels;
using Aidan.Core.Patterns;
using Speculum.Api.BrowserClients;
using Speculum.Api.Sessions.Models;
using Speculum.Api.Sessions.Requests;
using Speculum.Api.Sessions.Services;
using Speculum.Api.Sessions.Services.Contracts;

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
    public void CloseCaller_DisposesPipes_AndDetachesPresence()
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
        var pipe = new RecordingDisposable();
        Assert.True(registry.RegisterPipe(
            sessionId,
            "token",
            Guid.NewGuid(),
            pipe).IsSuccess);

        registry.CloseCaller("caller");

        Assert.True(pipe.IsDisposed);
        Assert.Equal(
            Guid.Parse("00000000-0000-0000-0000-000000000123"),
            live.DetachedAttachmentId);
        Assert.False(registry.TryGetLive(sessionId, "token", out _));
    }

    [Fact]
    public void WebTransportPipe_OpenClose_RegistersAndClearsOwnership()
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
        var pipeId = Guid.NewGuid();
        var pipe = new RecordingDisposable();

        Assert.True(registry.RegisterPipe(sessionId, "token", pipeId, pipe).IsSuccess);
        registry.UnregisterPipe(pipeId);

        Assert.True(pipe.IsDisposed);
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
        public Guid? DetachedAttachmentId { get; private set; }

        public IResult<Guid> Attach(IAttachedSessionClient client)
            => Result<Guid>.Success(Guid.NewGuid());

        public IResult Detach(Guid attachmentId)
        {
            DetachedAttachmentId = attachmentId;
            return Result.Success();
        }

        public IResult<IFrameStream> OpenFrameStream() => throw new NotSupportedException();
        public IResult<IConsoleOutputStream> OpenConsoleOutputStream() => throw new NotSupportedException();
        public IResult<INotificationStream> OpenNotificationStream() => throw new NotSupportedException();

        public IResult<Task> ConsumeUserInputAsync(
            ChannelReader<UserInput> channelReader,
            CancellationToken ct = default)
            => throw new NotSupportedException();

        public IResult AdmitUserInput(UserInput input) => Result.Success();

        public IResult<Task> ConsumeConsoleInputAsync(
            ChannelReader<ConsoleInput> channelReader,
            CancellationToken ct = default)
            => throw new NotSupportedException();

        public void TraceInputPathWtReceived(string kind) { }

        public void TraceInputPathControlReceived(string kind) { }

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

        public IResult<Guid> RegisterCameraPermission(
            Func<CancellationToken, Task<PermissionDecision>> handler)
            => throw new NotSupportedException();

        public IResult UnregisterCameraPermission(Guid registrationId)
            => throw new NotSupportedException();

        public IResult<Guid> RegisterMicrophonePermission(
            Func<CancellationToken, Task<PermissionDecision>> handler)
            => throw new NotSupportedException();

        public IResult UnregisterMicrophonePermission(Guid registrationId)
            => throw new NotSupportedException();
    }
}
