using System.Collections.Concurrent;
using System.Threading.Channels;
using Aidan.Core.Patterns;
using Speculum.Api.BrowserClients;
using Speculum.Api.Configurations.Models.Sessions;
using Speculum.Api.Sessions.Mirror.PageProjection;
using Speculum.Api.Sessions.Models;
using Speculum.Api.Sessions.Services.Contracts;
using Speculum.Api.Sessions.Services.Streaming;

namespace Speculum.Api.Sessions.Services;

/// <summary>
/// Multiplexes one sidecar connection's outbound events onto registered output streams
/// (one channel per open), and merges inbound pumps from input consumers.
/// </summary>
internal sealed class SessionStreamMultiplexer : ISessionStreamMultiplexer
{
    private readonly ISessionConnection _connection;
    private readonly ConcurrentDictionary<Guid, OutputStreamRegistration> _streams = new();
    private readonly ConcurrentDictionary<Guid, int> _inputConsumers = new();
    private readonly CancellationTokenSource _lifetime = new();
    private readonly SessionOutputFanOut _fanOut;
    private readonly SessionInputMerger _input;
    private int _disposed;

    public SessionStreamMultiplexer(
        ISessionConnection connection,
        InputMultiplexingPolicy inputPolicy,
        OutputMultiplexingPolicy outputPolicy,
        bool jsBridgeEnabled,
        MirrorMode mirrorMode)
    {
        _connection = connection;
        _fanOut = new SessionOutputFanOut(
            connection,
            _streams,
            outputPolicy ?? new OutputMultiplexingPolicy(),
            mirrorMode,
            _lifetime.Token);
        _input = new SessionInputMerger(
            connection,
            inputPolicy ?? new InputMultiplexingPolicy(),
            jsBridgeEnabled,
            IsInputConsumerAttached);
    }

    public bool IsEmpty => _streams.IsEmpty && _inputConsumers.IsEmpty;

    public bool IsAlive => Volatile.Read(ref _disposed) == 0;

    public bool IsBoundTo(ISessionConnection connection)
        => ReferenceEquals(_connection, connection);

    public void SetAttachedConsumer(Guid? consumerId)
        => _fanOut.SetAttachedConsumer(consumerId);

    public IResult RegisterOutputStream(Guid consumerId, Guid streamId, OutputStreamKind kind)
    {
        if (!IsAlive)
        {
            return Result.Failure("Multiplexer is disposed");
        }

        if (consumerId == Guid.Empty)
        {
            return Result.Failure("Consumer id is required");
        }

        var registration = kind switch
        {
            OutputStreamKind.Frame => OutputStreamRegistration.CreateFrame(streamId, consumerId),
            OutputStreamKind.PageProjectionFrames
                => OutputStreamRegistration.CreatePageProjectionFrames(streamId, consumerId),
            OutputStreamKind.Console => OutputStreamRegistration.CreateConsole(streamId, consumerId),
            OutputStreamKind.Notification
                => OutputStreamRegistration.CreateNotification(streamId, consumerId),
            _ => null,
        };
        if (registration is null)
        {
            return Result.Failure("Unknown output stream kind");
        }

        if (!_streams.TryAdd(streamId, registration))
        {
            registration.Complete();
            return Result.Failure("Stream already registered");
        }

        _fanOut.OnStreamRegistered(streamId);
        _connection.ReportPageProjectionFrameOutputStreamOpened(
            streamId,
            consumerId,
            OutputStreamKindNames.ToTelemetry(kind),
            openStreamCount: _streams.Count,
            frameChannelCapacity: kind == OutputStreamKind.PageProjectionFrames
                ? PageProjectionFrameChannels.FanOutTargetCapacity
                : 0);
        return Result.Success();
    }

    public void UnregisterOutputStream(Guid streamId)
    {
        if (!_streams.TryRemove(streamId, out var registration))
        {
            return;
        }

        _fanOut.OnStreamUnregistered(streamId);
        registration.Complete();
        _connection.ReportPageProjectionFrameOutputStreamClosed(
            streamId,
            registration.ConsumerId,
            OutputStreamKindNames.ToTelemetry(registration.Kind),
            openStreamCount: _streams.Count);
    }

    public IResult<long> GetFrameEpoch(Guid streamId)
    {
        if (!_streams.TryGetValue(streamId, out var registration)
            || registration.Kind != OutputStreamKind.PageProjectionFrames)
        {
            return Result<long>.Failure("Diff stream is not registered");
        }

        return Result<long>.Success(registration.FrameEpoch);
    }

    public IResult RegisterInputConsumer(Guid consumerId)
    {
        if (!IsAlive)
        {
            return Result.Failure("Multiplexer is disposed");
        }

        if (consumerId == Guid.Empty)
        {
            return Result.Failure("Consumer id is required");
        }

        _inputConsumers.AddOrUpdate(consumerId, 1, static (_, count) => count + 1);
        return Result.Success();
    }

    public void UnregisterInputConsumer(Guid consumerId)
    {
        while (true)
        {
            if (!_inputConsumers.TryGetValue(consumerId, out var count))
            {
                return;
            }

            if (count <= 1)
            {
                if (_inputConsumers.TryRemove(
                        new KeyValuePair<Guid, int>(consumerId, count)))
                {
                    _input.ReleaseOwnership(consumerId);
                    return;
                }

                continue;
            }

            if (_inputConsumers.TryUpdate(consumerId, count - 1, count))
            {
                return;
            }
        }
    }

    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0)
        {
            return;
        }

        foreach (var streamId in _streams.Keys.ToArray())
        {
            UnregisterOutputStream(streamId);
        }

        foreach (var consumerId in _inputConsumers.Keys.ToArray())
        {
            while (_inputConsumers.ContainsKey(consumerId))
            {
                UnregisterInputConsumer(consumerId);
            }
        }

        try
        {
            _lifetime.Cancel();
        }
        finally
        {
            _input.Complete();
            _lifetime.Dispose();
        }
    }

    public IResult<ChannelReader<Frame>> GetFramesChannel(Guid streamId)
    {
        if (!_streams.TryGetValue(streamId, out var registration)
            || registration.Frames is null)
        {
            return Result<ChannelReader<Frame>>.Failure("Frame stream is not registered");
        }

        return Result<ChannelReader<Frame>>.Success(registration.Frames.Reader);
    }

    public IResult<ChannelReader<PageProjectionFrame>> GetPageProjectionFramesChannel(Guid streamId)
    {
        if (!_streams.TryGetValue(streamId, out var registration)
            || registration.Kind != OutputStreamKind.PageProjectionFrames)
        {
            return Result<ChannelReader<PageProjectionFrame>>.Failure("Diff stream is not registered");
        }

        return Result<ChannelReader<PageProjectionFrame>>.Success(registration.PageProjectionFrames.Reader);
    }

    public IResult<ChannelReader<ConsoleOutput>> GetConsoleOutputChannel(Guid streamId)
    {
        if (!_streams.TryGetValue(streamId, out var registration)
            || registration.Console is null)
        {
            return Result<ChannelReader<ConsoleOutput>>.Failure("Console stream is not registered");
        }

        return Result<ChannelReader<ConsoleOutput>>.Success(registration.Console.Reader);
    }

    public IResult<ChannelReader<SessionNotification>> GetNotificationChannel(Guid streamId)
    {
        if (!_streams.TryGetValue(streamId, out var registration)
            || registration.Notifications is null)
        {
            return Result<ChannelReader<SessionNotification>>.Failure(
                "Notification stream is not registered");
        }

        return Result<ChannelReader<SessionNotification>>.Success(registration.Notifications.Reader);
    }

    public IResult<Task> StartVideoStreamingInputPump(
        Guid consumerId,
        ChannelReader<VideoStreamingInput> channelReader,
        CancellationToken ct)
        => _input.StartVideoStreamingInputPump(consumerId, channelReader, ct);

    public IResult<Task> StartConsoleInputPump(
        Guid consumerId,
        ChannelReader<ConsoleInput> channelReader,
        CancellationToken ct)
        => _input.StartConsoleInputPump(consumerId, channelReader, ct);

    private bool IsInputConsumerAttached(Guid consumerId)
        => _inputConsumers.ContainsKey(consumerId);
}
