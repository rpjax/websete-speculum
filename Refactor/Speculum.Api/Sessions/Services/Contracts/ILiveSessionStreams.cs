using System.Threading.Channels;
using Aidan.Core.Patterns;
using Speculum.Api.Sessions.Mirror.PageProjection;
using Speculum.Api.Sessions.Models;

namespace Speculum.Api.Sessions.Services.Contracts;

/// <summary>Per-consumer screencast frame stream. Dispose unregisters from the mux.</summary>
public interface IFrameStream : IDisposable
{
    Guid Id { get; }

    Guid ConsumerId { get; }

    IResult<ChannelReader<Frame>> GetFramesChannel();
}

/// <summary>Per-consumer Dom Projection diff stream. Dispose unregisters from the mux.</summary>
public interface IPageProjectionFramesStream : IDisposable
{
    Guid Id { get; }

    Guid ConsumerId { get; }

    IResult<ChannelReader<PageProjectionDiff>> GetPageProjectionDiffsChannel();

    /// <summary>Current Diff channel epoch for this stream (-1 when unregistered).</summary>
    long GetDiffEpoch();
}

/// <summary>Per-consumer browser console output stream. Dispose unregisters from the mux.</summary>
public interface IConsoleOutputStream : IDisposable
{
    Guid Id { get; }

    Guid ConsumerId { get; }

    IResult<ChannelReader<ConsoleOutput>> GetConsoleOutputChannel();
}

/// <summary>Per-consumer informative notification stream. Dispose unregisters from the mux.</summary>
public interface INotificationStream : IDisposable
{
    Guid Id { get; }

    Guid ConsumerId { get; }

    IResult<ChannelReader<SessionNotification>> GetNotificationChannel();
}
