using System.Threading.Channels;
using Aidan.Core.Patterns;
using Speculum.Api.BrowserClients;
using Speculum.Api.Sessions.Models;

namespace Speculum.Api.Sessions.Services.Contracts;

/// <summary>
/// Internal stream multiplexer for one live <see cref="ISessionConnection"/>:
/// fan-out, input merge, and per-consumer channel registry. Not a public application port.
/// Dispose retires the multiplexer (LiveSession teardown).
/// </summary>
internal interface ISessionStreamMultiplexer : IDisposable
{
    bool IsEmpty { get; }

    /// <summary>False after <see cref="IDisposable.Dispose"/>.</summary>
    bool IsAlive { get; }

    bool IsBoundTo(ISessionConnection connection);

    /// <summary>Registers an output consumer (frame/console/notification channels).</summary>
    IResult RegisterPipe(Guid pipeId);

    void UnregisterPipe(Guid pipeId);

    /// <summary>
    /// Registers an input-only consumer (no output channels, does not start fan-out).
    /// </summary>
    IResult RegisterInputConsumer(Guid consumerId);

    void UnregisterInputConsumer(Guid consumerId);

    IResult<ChannelReader<Frame>> GetFramesChannel(Guid pipeId);

    IResult<ChannelReader<ConsoleOutput>> GetConsoleOutputChannel(Guid pipeId);

    IResult<ChannelReader<SessionNotification>> GetNotificationChannel(Guid pipeId);

    IResult<Task> StartUserInputPump(
        Guid consumerId,
        ChannelReader<UserInput> channelReader,
        CancellationToken ct);

    IResult<Task> StartConsoleInputPump(
        Guid consumerId,
        ChannelReader<ConsoleInput> channelReader,
        CancellationToken ct);
}
