using System.Threading.Channels;
using Aidan.Core.Patterns;
using Speculum.Api.Sessions.Mirror.DomProjection;
using Speculum.Api.Sessions.Models;
using Speculum.Api.Sessions.Services.Contracts;

namespace Speculum.Api.Sessions.Services;

internal abstract class MuxBoundStream : IDisposable
{
    private const string ClosedMessage = "Stream is closed";
    private readonly ISessionStreamMultiplexer _mux;
    private int _closed;

    public Guid Id { get; }

    private protected MuxBoundStream(Guid id, ISessionStreamMultiplexer mux)
    {
        Id = id;
        _mux = mux;
    }

    public void Dispose()
    {
        if (Interlocked.Exchange(ref _closed, 1) != 0)
        {
            return;
        }

        _mux.UnregisterPipe(Id);
    }

    private protected bool IsClosed => Volatile.Read(ref _closed) != 0;

    private protected IResult<ChannelReader<T>> GetChannel<T>(
        Func<Guid, IResult<ChannelReader<T>>> get)
    {
        if (IsClosed)
        {
            return Result<ChannelReader<T>>.Failure(ClosedMessage);
        }

        return get(Id);
    }

    private protected ISessionStreamMultiplexer Mux => _mux;
}

internal sealed class FrameStream : MuxBoundStream, IFrameStream
{
    public FrameStream(Guid id, ISessionStreamMultiplexer mux)
        : base(id, mux)
    {
    }

    public IResult<ChannelReader<Frame>> GetFramesChannel()
        => GetChannel(Mux.GetFramesChannel);
}

internal sealed class DomDiffStream : MuxBoundStream, IDomDiffStream
{
    public DomDiffStream(Guid id, ISessionStreamMultiplexer mux)
        : base(id, mux)
    {
    }

    public IResult<ChannelReader<DomDiff>> GetDomDiffsChannel()
        => GetChannel(Mux.GetDomDiffsChannel);
}

internal sealed class ConsoleOutputStream : MuxBoundStream, IConsoleOutputStream
{
    public ConsoleOutputStream(Guid id, ISessionStreamMultiplexer mux)
        : base(id, mux)
    {
    }

    public IResult<ChannelReader<ConsoleOutput>> GetConsoleOutputChannel()
        => GetChannel(Mux.GetConsoleOutputChannel);
}

internal sealed class NotificationStream : MuxBoundStream, INotificationStream
{
    public NotificationStream(Guid id, ISessionStreamMultiplexer mux)
        : base(id, mux)
    {
    }

    public IResult<ChannelReader<SessionNotification>> GetNotificationChannel()
        => GetChannel(Mux.GetNotificationChannel);
}
