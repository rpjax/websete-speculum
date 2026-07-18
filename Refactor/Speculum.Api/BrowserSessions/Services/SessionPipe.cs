using System.Threading.Channels;
using Aidan.Core.Patterns;
using Speculum.Api.BrowserClients;
using Speculum.Api.BrowserSessions.Models;
using Speculum.Api.BrowserSessions.Services.Contracts;

namespace Speculum.Api.BrowserSessions.Services;

public sealed class SessionPipe : ISessionPipe
{
    private const string ClosedMessage = "Pipe is closed";

    private int _closed;
    private CancellationTokenSource? _lifetime = new();

    public Guid Id { get; }
    public Guid SessionId { get; }

    private readonly ISessionConnection _connection;

    public SessionPipe(
        Guid id,
        Guid sessionId,
        ISessionConnection connection)
    {
        Id = id;
        SessionId = sessionId;
        _connection = connection;
    }

    /// <summary>
    /// Marks this pipe closed and cancels in-flight consumer work.
    /// Only <see cref="SessionPipeService"/> should call this.
    /// </summary>
    internal void Close()
    {
        if (Interlocked.Exchange(ref _closed, 1) != 0)
        {
            return;
        }

        var lifetime = Interlocked.Exchange(ref _lifetime, null);
        if (lifetime is null)
        {
            return;
        }

        try
        {
            lifetime.Cancel();
        }
        finally
        {
            lifetime.Dispose();
        }
    }

    private bool IsClosed => Volatile.Read(ref _closed) != 0;

    public IResult<ChannelReader<Frame>> GetFramesChannel()
    {
        if (IsClosed)
        {
            return Result<ChannelReader<Frame>>.Failure(ClosedMessage);
        }

        throw new NotImplementedException();
    }

    public IResult<ChannelReader<ConsoleOutput>> GetConsoleOutputChannel()
    {
        if (IsClosed)
        {
            return Result<ChannelReader<ConsoleOutput>>.Failure(ClosedMessage);
        }

        throw new NotImplementedException();
    }

    public IResult<ChannelReader<SessionStatus>> GetStatusChannel()
    {
        if (IsClosed)
        {
            return Result<ChannelReader<SessionStatus>>.Failure(ClosedMessage);
        }

        throw new NotImplementedException();
    }

    public IResult<Task> ConsumeUserInputAsync(
        ChannelReader<string> channelReader,
        CancellationToken ct = default)
    {
        if (IsClosed)
        {
            return Result<Task>.Failure(ClosedMessage);
        }

        // When implementing: link ct with _lifetime.Token so Close() stops the pump.
        throw new NotImplementedException();
    }

    public IResult<Task> ConsumeConsoleInputAsync(
        ChannelReader<ConsoleInput> channelReader,
        CancellationToken ct = default)
    {
        if (IsClosed)
        {
            return Result<Task>.Failure(ClosedMessage);
        }

        // When implementing: link ct with _lifetime.Token so Close() stops the pump.
        throw new NotImplementedException();
    }
}
