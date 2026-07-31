using System.Collections.Concurrent;
using System.Threading.Channels;
using Aidan.Core.Patterns;
using Speculum.Api.BrowserClients;
using Speculum.Api.Configurations.Models.Sessions;
using Speculum.Api.Sessions.Models;
using Speculum.Api.Sessions.Services.Contracts;
using Speculum.Api.Sessions.Services.Streaming;

namespace Speculum.Api.Sessions.Services;

/// <summary>
/// Multiplexes one sidecar connection's streams onto N registered output consumers,
/// and merges inbound pumps from input consumers.
/// </summary>
internal sealed class SessionStreamMultiplexer : ISessionStreamMultiplexer
{
    private readonly ISessionConnection _connection;
    private readonly ConcurrentDictionary<Guid, PipeStreamChannels> _pipes = new();
    private readonly ConcurrentDictionary<Guid, byte> _inputConsumers = new();
    private readonly CancellationTokenSource _lifetime = new();
    private readonly SessionOutputFanOut _fanOut;
    private readonly SessionInputMerger _input;
    private int _disposed;

    public SessionStreamMultiplexer(
        ISessionConnection connection,
        InputMultiplexingPolicy inputPolicy,
        OutputMultiplexingPolicy outputPolicy,
        bool jsBridgeEnabled)
    {
        _connection = connection;
        _fanOut = new SessionOutputFanOut(
            connection,
            _pipes,
            outputPolicy ?? new OutputMultiplexingPolicy(),
            _lifetime.Token);
        _input = new SessionInputMerger(
            connection,
            inputPolicy ?? new InputMultiplexingPolicy(),
            jsBridgeEnabled,
            IsInputConsumerAttached);
    }

    public bool IsEmpty => _pipes.IsEmpty && _inputConsumers.IsEmpty;

    public bool IsAlive => Volatile.Read(ref _disposed) == 0;

    public bool IsBoundTo(ISessionConnection connection)
        => ReferenceEquals(_connection, connection);

    public IResult RegisterPipe(Guid pipeId)
    {
        if (!IsAlive)
        {
            return Result.Failure("Multiplexer is disposed");
        }

        var channels = new PipeStreamChannels(
            DropOldestChannels.Create<Frame>(capacity: 2),
            DropOldestChannels.Create<ConsoleOutput>(capacity: 256),
            DropOldestChannels.Create<SessionNotification>(capacity: 32));

        if (!_pipes.TryAdd(pipeId, channels))
        {
            channels.Complete();
            return Result.Failure("Pipe already registered");
        }

        _fanOut.EnsureStarted();
        return Result.Success();
    }

    public void UnregisterPipe(Guid pipeId)
    {
        if (!_pipes.TryRemove(pipeId, out var channels))
        {
            return;
        }

        channels.Complete();
    }

    public IResult RegisterInputConsumer(Guid consumerId)
    {
        if (!IsAlive)
        {
            return Result.Failure("Multiplexer is disposed");
        }

        return _inputConsumers.TryAdd(consumerId, 0)
            ? Result.Success()
            : Result.Failure("Input consumer already registered");
    }

    public void UnregisterInputConsumer(Guid consumerId)
    {
        if (!_inputConsumers.TryRemove(consumerId, out _))
        {
            return;
        }

        _input.ReleaseOwnership(consumerId);
    }

    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0)
        {
            return;
        }

        foreach (var pipeId in _pipes.Keys.ToArray())
        {
            UnregisterPipe(pipeId);
        }

        foreach (var consumerId in _inputConsumers.Keys.ToArray())
        {
            UnregisterInputConsumer(consumerId);
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

    public IResult<ChannelReader<Frame>> GetFramesChannel(Guid pipeId)
    {
        if (!_pipes.TryGetValue(pipeId, out var channels))
        {
            return Result<ChannelReader<Frame>>.Failure("Pipe is not registered");
        }

        return Result<ChannelReader<Frame>>.Success(channels.Frames.Reader);
    }

    public IResult<ChannelReader<ConsoleOutput>> GetConsoleOutputChannel(Guid pipeId)
    {
        if (!_pipes.TryGetValue(pipeId, out var channels))
        {
            return Result<ChannelReader<ConsoleOutput>>.Failure("Pipe is not registered");
        }

        return Result<ChannelReader<ConsoleOutput>>.Success(channels.Console.Reader);
    }

    public IResult<ChannelReader<SessionNotification>> GetNotificationChannel(Guid pipeId)
    {
        if (!_pipes.TryGetValue(pipeId, out var channels))
        {
            return Result<ChannelReader<SessionNotification>>.Failure("Pipe is not registered");
        }

        return Result<ChannelReader<SessionNotification>>.Success(channels.Notifications.Reader);
    }

    public IResult<Task> StartUserInputPump(
        Guid consumerId,
        ChannelReader<UserInput> channelReader,
        CancellationToken ct)
        => _input.StartUserInputPump(consumerId, channelReader, ct);

    public IResult<Task> StartConsoleInputPump(
        Guid consumerId,
        ChannelReader<ConsoleInput> channelReader,
        CancellationToken ct)
        => _input.StartConsoleInputPump(consumerId, channelReader, ct);

    private bool IsInputConsumerAttached(Guid consumerId)
        => _inputConsumers.ContainsKey(consumerId);
}
