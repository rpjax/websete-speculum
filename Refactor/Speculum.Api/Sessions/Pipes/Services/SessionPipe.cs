using System.Threading.Channels;
using Aidan.Core.Patterns;
using Speculum.Api.Sessions.Models;
using Speculum.Api.Sessions.Pipes.Services.Contracts;
using Speculum.Api.Sessions.Pipes.Streaming;

namespace Speculum.Api.Sessions.Pipes.Services;

/// <summary>
/// Thin application handle over a registered pipe; forwards I/O to the session stream multiplexer.
/// </summary>
public sealed class SessionPipe : ISessionPipe
{
    private const string ClosedMessage = "Pipe is closed";

    private int _closed;
    private CancellationTokenSource? _lifetime = new();

    private readonly ISessionStreamMultiplexer _multiplexer;

    public Guid Id { get; }
    public Guid SessionId { get; }

    internal SessionPipe(
        Guid id,
        Guid sessionId,
        ISessionStreamMultiplexer multiplexer)
    {
        Id = id;
        SessionId = sessionId;
        _multiplexer = multiplexer;
    }

    /// <summary>
    /// Marks this pipe closed, unregisters from the multiplexer, and cancels in-flight consumer work.
    /// Only <see cref="SessionPipeService"/> should call this.
    /// </summary>
    internal void Close()
    {
        if (Interlocked.Exchange(ref _closed, 1) != 0)
        {
            return;
        }

        _multiplexer.UnregisterPipe(Id);

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

        return _multiplexer.GetFramesChannel(Id);
    }

    public IResult<ChannelReader<ConsoleOutput>> GetConsoleOutputChannel()
    {
        if (IsClosed)
        {
            return Result<ChannelReader<ConsoleOutput>>.Failure(ClosedMessage);
        }

        return _multiplexer.GetConsoleOutputChannel(Id);
    }

    public IResult<ChannelReader<SessionNotification>> GetNotificationChannel()
    {
        if (IsClosed)
        {
            return Result<ChannelReader<SessionNotification>>.Failure(ClosedMessage);
        }

        return _multiplexer.GetNotificationChannel(Id);
    }

    public Task<IResult<SessionStatus>> GetStatusAsync(CancellationToken ct = default)
    {
        if (IsClosed)
        {
            return Task.FromResult<IResult<SessionStatus>>(
                Result<SessionStatus>.Failure(ClosedMessage));
        }

        return _multiplexer.GetStatusAsync(ct);
    }

    public IResult<Task> ConsumeUserInputAsync(
        ChannelReader<string> channelReader,
        CancellationToken ct = default)
    {
        if (IsClosed)
        {
            return Result<Task>.Failure(ClosedMessage);
        }

        var lifetime = Volatile.Read(ref _lifetime);
        if (lifetime is null)
        {
            return Result<Task>.Failure(ClosedMessage);
        }

        var linked = CancellationTokenSource.CreateLinkedTokenSource(ct, lifetime.Token);
        var pump = _multiplexer.StartUserInputPump(Id, channelReader, linked.Token);
        if (pump.IsFailure)
        {
            linked.Dispose();
            return pump;
        }

        return Result<Task>.Success(ObserveAndDisposeAsync(pump.Value, linked));
    }

    public IResult<Task> ConsumeConsoleInputAsync(
        ChannelReader<ConsoleInput> channelReader,
        CancellationToken ct = default)
    {
        if (IsClosed)
        {
            return Result<Task>.Failure(ClosedMessage);
        }

        var lifetime = Volatile.Read(ref _lifetime);
        if (lifetime is null)
        {
            return Result<Task>.Failure(ClosedMessage);
        }

        var linked = CancellationTokenSource.CreateLinkedTokenSource(ct, lifetime.Token);
        var pump = _multiplexer.StartConsoleInputPump(Id, channelReader, linked.Token);
        if (pump.IsFailure)
        {
            linked.Dispose();
            return pump;
        }

        return Result<Task>.Success(ObserveAndDisposeAsync(pump.Value, linked));
    }

    private static async Task ObserveAndDisposeAsync(Task pump, CancellationTokenSource linked)
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
}
