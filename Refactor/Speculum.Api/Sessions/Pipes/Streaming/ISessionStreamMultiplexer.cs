using System.Threading.Channels;
using Aidan.Core.Patterns;
using Speculum.Api.BrowserClients;
using Speculum.Api.Sessions.Models;

namespace Speculum.Api.Sessions.Pipes.Streaming;

/// <summary>
/// Internal stream multiplexer for one live <see cref="ISessionConnection"/>:
/// fan-out, input merge, and per-pipe channel registry. Not a public application port.
/// </summary>
internal interface ISessionStreamMultiplexer
{
    bool IsEmpty { get; }

    /// <summary>
    /// False after the last pipe unregisters and the multiplexer is retired.
    /// </summary>
    bool IsAlive { get; }

    bool IsBoundTo(ISessionConnection connection);

    IResult RegisterPipe(Guid pipeId);

    void UnregisterPipe(Guid pipeId);

    IResult<ChannelReader<Frame>> GetFramesChannel(Guid pipeId);

    IResult<ChannelReader<ConsoleOutput>> GetConsoleOutputChannel(Guid pipeId);

    IResult<ChannelReader<SessionNotification>> GetNotificationChannel(Guid pipeId);

    IResult<Task> StartUserInputPump(
        Guid pipeId,
        ChannelReader<string> channelReader,
        CancellationToken ct);

    IResult<Task> StartConsoleInputPump(
        Guid pipeId,
        ChannelReader<ConsoleInput> channelReader,
        CancellationToken ct);
}
