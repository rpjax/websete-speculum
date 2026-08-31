using System.Threading.Channels;
using Aidan.Core.Patterns;
using Speculum.Api.Configurations.Models.Sessions;
using Speculum.Api.Sessions.Mirror;
using Speculum.Api.Sessions.Models;
using Speculum.Api.Sessions.Services.Contracts;
using Speculum.Api.Sessions.Services.Streaming;

namespace Speculum.Api.Sessions.Services;

internal sealed partial class LiveSession
{
    // ── Streams ──────────────────────────────────────────────────────────────

    public IResult<IFrameStream> OpenFrameStream(Guid consumerId)
    {
        if (_mirrorMode != global::Speculum.Api.Configurations.Models.Sessions.MirrorMode.VideoStreaming)
        {
            return Result<IFrameStream>.Failure(SessionMirrorErrors.VideoStreamingRequiredMessage);
        }

        return OpenStream(
            consumerId,
            OutputStreamKind.Frame,
            static (id, owner, mux) => (IFrameStream)new FrameStream(id, owner, mux));
    }

    public IResult<IPageProjectionFramesStream> OpenPageProjectionFramesStream(Guid consumerId)
    {
        if (_mirrorMode != global::Speculum.Api.Configurations.Models.Sessions.MirrorMode.PageProjection)
        {
            return Result<IPageProjectionFramesStream>.Failure(SessionMirrorErrors.PageProjectionRequiredMessage);
        }

        return OpenStream(
            consumerId,
            OutputStreamKind.PageProjectionFrames,
            static (id, owner, mux) => (IPageProjectionFramesStream)new PageProjectionFramesStream(id, owner, mux));
    }

    public IResult<IConsoleOutputStream> OpenConsoleOutputStream(Guid consumerId)
        => OpenStream(
            consumerId,
            OutputStreamKind.Console,
            static (id, owner, mux) => (IConsoleOutputStream)new ConsoleOutputStream(id, owner, mux));

    public IResult<INotificationStream> OpenNotificationStream(Guid consumerId)
        => OpenStream(
            consumerId,
            OutputStreamKind.Notification,
            static (id, owner, mux) => (INotificationStream)new NotificationStream(id, owner, mux));

    public IResult<Task> ConsumeVideoStreamingInputAsync(
        Guid consumerId,
        ChannelReader<VideoStreamingInput> channelReader,
        CancellationToken ct = default)
    {
        if (_mirrorMode != global::Speculum.Api.Configurations.Models.Sessions.MirrorMode.VideoStreaming)
        {
            return Result<Task>.Failure(SessionMirrorErrors.VideoStreamingRequiredMessage);
        }

        return StartInputPump(
            consumerId,
            (id, token) => _mux.StartVideoStreamingInputPump(id, channelReader, token),
            ct);
    }

    public IResult AdmitVideoStreamingInput(VideoStreamingInput input)
    {
        ArgumentNullException.ThrowIfNull(input);
        if (_mirrorMode != global::Speculum.Api.Configurations.Models.Sessions.MirrorMode.VideoStreaming)
        {
            return Result.Failure(SessionMirrorErrors.VideoStreamingRequiredMessage);
        }

        if (string.IsNullOrWhiteSpace(input.Type) || string.IsNullOrWhiteSpace(input.Payload))
        {
            return Result.Failure("VideoStreamingInput type and payload are required");
        }

        var ensure = EnsureVideoStreamingInputPipe();
        if (ensure.IsFailure)
        {
            return ensure;
        }

        var pipe = Volatile.Read(ref _videoStreamingInputPipe);
        if (pipe is null)
        {
            return Result.Failure("Video streaming input pipe is not ready");
        }

        if (!TryGetLifetimeToken(out var lifetimeToken))
        {
            return Result.Failure("Live session is released");
        }

        return SessionInputPipe.Write(pipe.Writer, new VideoStreamingInput
        {
            Type = input.Type.Trim(),
            Payload = input.Payload,
            TraceId = input.TraceId,
            ClientTimestampMs = input.ClientTimestampMs,
        }, lifetimeToken);
    }

    public IResult AdmitPageProjectionInput(PageProjectionIntent input)
    {
        ArgumentNullException.ThrowIfNull(input);
        if (_mirrorMode != global::Speculum.Api.Configurations.Models.Sessions.MirrorMode.PageProjection)
        {
            return Result.Failure(SessionMirrorErrors.PageProjectionRequiredMessage);
        }

        if (string.IsNullOrWhiteSpace(input.Type))
        {
            return Result.Failure("PageProjectionIntent type is required");
        }

        var ensure = EnsurePageProjectionInputPipe();
        if (ensure.IsFailure)
        {
            return ensure;
        }

        var pipe = Volatile.Read(ref _pageProjectionInputPipe);
        if (pipe is null)
        {
            return Result.Failure("Dom projection input pipe is not ready");
        }

        if (!TryGetLifetimeToken(out var lifetimeToken))
        {
            return Result.Failure("Live session is released");
        }

        return SessionInputPipe.Write(pipe.Writer, new PageProjectionIntent
        {
            Generation = input.Generation,
            Type = input.Type.Trim(),
            Anchor = input.Anchor,
            TargetId = input.TargetId,
            ContextId = input.ContextId > 0 ? input.ContextId : 1,
            TimestampClient = input.TimestampClient,
            TraceId = input.TraceId,
            Payload = string.IsNullOrWhiteSpace(input.Payload) ? "{}" : input.Payload,
        }, lifetimeToken);
    }

    public IResult<Task> ConsumePageProjectionIntentAsync(
        ChannelReader<PageProjectionIntent> channelReader,
        CancellationToken ct = default)
    {
        if (_mirrorMode != global::Speculum.Api.Configurations.Models.Sessions.MirrorMode.PageProjection)
        {
            return Result<Task>.Failure(SessionMirrorErrors.PageProjectionRequiredMessage);
        }

        if (IsReleased)
        {
            return Result<Task>.Failure("Live session is released");
        }

        if (!TryGetLifetimeToken(out var lifetimeToken))
        {
            return Result<Task>.Failure("Live session is released");
        }

        var linked = CancellationTokenSource.CreateLinkedTokenSource(ct, lifetimeToken);
        var pump = _connection.ConsumePageProjectionIntentAsync(channelReader);
        if (pump.IsFailure)
        {
            linked.Dispose();
            return pump;
        }

        return Result<Task>.Success(ObservePageProjectionPumpAsync(pump.Value, linked));
    }

    public IResult<Task> ConsumeConsoleInputAsync(
        Guid consumerId,
        ChannelReader<ConsoleInput> channelReader,
        CancellationToken ct = default)
        => StartInputPump(
            consumerId,
            (id, token) => _mux.StartConsoleInputPump(id, channelReader, token),
            ct);

    private IResult EnsureVideoStreamingInputPipe()
    {
        if (IsReleased)
        {
            return Result.Failure("Live session is released");
        }

        if (Interlocked.CompareExchange(ref _videoStreamingInputPipeStarted, 1, 0) != 0)
        {
            var spun = 0;
            while (Volatile.Read(ref _videoStreamingInputPipe) is null && !IsReleased && spun < 200)
            {
                Thread.SpinWait(20);
                spun++;
            }

            return Volatile.Read(ref _videoStreamingInputPipe) is null
                ? Result.Failure("User input pipe failed to start")
                : Result.Success();
        }

        var pipe = SessionInputPipe.Create<VideoStreamingInput>();
        Volatile.Write(ref _videoStreamingInputPipe, pipe);
        Guid consumerId;
        lock (_attachmentGate)
        {
            if (_attachmentId is not Guid attached)
            {
                Volatile.Write(ref _videoStreamingInputPipe, null);
                Interlocked.Exchange(ref _videoStreamingInputPipeStarted, 0);
                pipe.Writer.TryComplete();
                return Result.Failure("No client attached");
            }

            consumerId = attached;
        }

        var pump = ConsumeVideoStreamingInputAsync(consumerId, pipe.Reader);
        if (pump.IsFailure)
        {
            Volatile.Write(ref _videoStreamingInputPipe, null);
            Interlocked.Exchange(ref _videoStreamingInputPipeStarted, 0);
            pipe.Writer.TryComplete();
            return Result.Failure(pump.Errors.ToArray());
        }

        _ = ObserveInputPumpAsync(pump.Value);
        return Result.Success();
    }

    private IResult EnsurePageProjectionInputPipe()
    {
        if (IsReleased)
        {
            return Result.Failure("Live session is released");
        }

        if (Interlocked.CompareExchange(ref _pageProjectionInputPipeStarted, 1, 0) != 0)
        {
            var spun = 0;
            while (Volatile.Read(ref _pageProjectionInputPipe) is null && !IsReleased && spun < 200)
            {
                Thread.SpinWait(20);
                spun++;
            }

            return Volatile.Read(ref _pageProjectionInputPipe) is null
                ? Result.Failure("Dom projection input pipe failed to start")
                : Result.Success();
        }

        var pipe = SessionInputPipe.Create<PageProjectionIntent>();
        Volatile.Write(ref _pageProjectionInputPipe, pipe);
        var pump = ConsumePageProjectionIntentAsync(pipe.Reader);
        if (pump.IsFailure)
        {
            Volatile.Write(ref _pageProjectionInputPipe, null);
            Interlocked.Exchange(ref _pageProjectionInputPipeStarted, 0);
            pipe.Writer.TryComplete();
            return Result.Failure(pump.Errors.ToArray());
        }

        _ = ObserveInputPumpAsync(pump.Value);
        return Result.Success();
    }

    private async Task ObservePageProjectionPumpAsync(Task pump, CancellationTokenSource linked)
    {
        try
        {
            await pump.ConfigureAwait(false);
        }
        finally
        {
            linked.Dispose();
        }
    }

    private async Task ObserveInputPumpAsync(Task pump)
    {
        try
        {
            await pump.ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            // session released
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Session {SessionId} user-input pump faulted.", SessionId);
        }
    }

    private IResult<TStream> OpenStream<TStream>(
        Guid consumerId,
        OutputStreamKind kind,
        Func<Guid, Guid, ISessionStreamMultiplexer, TStream> create)
    {
        if (IsReleased)
        {
            return Result<TStream>.Failure("Live session is released");
        }

        if (consumerId == Guid.Empty)
        {
            return Result<TStream>.Failure("Consumer id is required");
        }

        var id = Guid.CreateVersion7();
        var register = _mux.RegisterOutputStream(consumerId, id, kind);
        if (register.IsFailure)
        {
            return Result<TStream>.Failure(register.Errors.ToArray());
        }

        return Result<TStream>.Success(create(id, consumerId, _mux));
    }

    private IResult<Task> StartInputPump(
        Guid consumerId,
        Func<Guid, CancellationToken, IResult<Task>> start,
        CancellationToken ct)
    {
        if (IsReleased)
        {
            return Result<Task>.Failure("Live session is released");
        }

        if (consumerId == Guid.Empty)
        {
            return Result<Task>.Failure("Consumer id is required");
        }

        if (!TryGetLifetimeToken(out var lifetimeToken))
        {
            return Result<Task>.Failure("Live session is released");
        }

        var register = _mux.RegisterInputConsumer(consumerId);
        if (register.IsFailure)
        {
            return Result<Task>.Failure(register.Errors.ToArray());
        }

        var linked = CancellationTokenSource.CreateLinkedTokenSource(ct, lifetimeToken);
        var pump = start(consumerId, linked.Token);
        if (pump.IsFailure)
        {
            linked.Dispose();
            _mux.UnregisterInputConsumer(consumerId);
            return pump;
        }

        return Result<Task>.Success(
            ObserveAndUnregisterAsync(pump.Value, linked, consumerId));
    }

    private async Task ObserveAndUnregisterAsync(
        Task pump,
        CancellationTokenSource linked,
        Guid consumerId)
    {
        try
        {
            await pump.ConfigureAwait(false);
        }
        finally
        {
            linked.Dispose();
            _mux.UnregisterInputConsumer(consumerId);
        }
    }
}
