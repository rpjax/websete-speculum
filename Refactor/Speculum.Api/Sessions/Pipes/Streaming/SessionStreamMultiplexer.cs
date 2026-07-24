using System.Collections.Concurrent;
using System.Threading.Channels;
using Aidan.Core.Patterns;
using Speculum.Api.BrowserClients;
using Speculum.Api.Configurations.Models.Sessions;
using Speculum.Api.Sessions.Models;

namespace Speculum.Api.Sessions.Pipes.Streaming;

/// <summary>
/// Multiplexes one sidecar connection's streams onto N registered pipes.
/// </summary>
internal sealed class SessionStreamMultiplexer : ISessionStreamMultiplexer
{
    private readonly ISessionConnection _connection;
    private readonly ConcurrentDictionary<Guid, PipeStreamChannels> _pipes = new();
    private readonly CancellationTokenSource _lifetime = new();
    private readonly SessionOutputFanOut _fanOut;
    private readonly SessionInputMerger _input;

    public SessionStreamMultiplexer(
        ISessionConnection connection,
        InputAccessPolicy inputAccess,
        bool jsBridgeEnabled)
    {
        _connection = connection;
        _fanOut = new SessionOutputFanOut(connection, _pipes, _lifetime.Token);
        _input = new SessionInputMerger(
            connection,
            inputAccess,
            jsBridgeEnabled,
            pipeId => _pipes.ContainsKey(pipeId));
    }

    public bool IsEmpty => _pipes.IsEmpty;

    public bool IsAlive => !_lifetime.IsCancellationRequested;

    public bool IsBoundTo(ISessionConnection connection)
        => ReferenceEquals(_connection, connection);

    public IResult RegisterPipe(Guid pipeId)
    {
        if (!IsAlive)
        {
            return Result.Failure("Multiplexer is retired");
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
        _input.ReleaseOwnership(pipeId);

        if (_pipes.IsEmpty)
        {
            _lifetime.Cancel();
            _input.Complete();
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

    public Task<IResult<SessionStatus>> GetStatusAsync(CancellationToken ct = default)
        => _connection.GetStatusAsync(ct);

    public IResult<Task> StartUserInputPump(
        Guid pipeId,
        ChannelReader<string> channelReader,
        CancellationToken ct)
        => _input.StartUserInputPump(pipeId, channelReader, ct);

    public IResult<Task> StartConsoleInputPump(
        Guid pipeId,
        ChannelReader<ConsoleInput> channelReader,
        CancellationToken ct)
        => _input.StartConsoleInputPump(pipeId, channelReader, ct);
}
