using System.Threading.Channels;
using Aidan.Core.Patterns;
using Speculum.Api.BrowserClients;
using Speculum.Api.Sessions.Mirror.PageProjection;
using Speculum.Api.Sessions.Models;
using Speculum.Api.Sessions.Services.Streaming;

namespace Speculum.Api.Sessions.Services.Contracts;

/// <summary>
/// Internal stream multiplexer for one live <see cref="ISessionConnection"/>:
/// kind-filtered fan-out, input merge, and per-stream registry. Not a public application port.
/// Dispose retires the multiplexer (LiveSession teardown).
/// </summary>
internal interface ISessionStreamMultiplexer : IDisposable
{
    bool IsEmpty { get; }

    /// <summary>False after <see cref="IDisposable.Dispose"/>.</summary>
    bool IsAlive { get; }

    bool IsBoundTo(ISessionConnection connection);

    /// <summary>
    /// Registers one outbound stream of <paramref name="kind"/> owned by <paramref name="consumerId"/>.
    /// </summary>
    IResult RegisterOutputStream(Guid consumerId, Guid streamId, OutputStreamKind kind);

    void UnregisterOutputStream(Guid streamId);

    /// <summary>Notifies Exclusive/FirstAttached which consumer is currently attached.</summary>
    void SetAttachedConsumer(Guid? consumerId);

    /// <summary>Diff channel epoch for a Diff stream (bumped on Replace).</summary>
    IResult<long> GetDiffEpoch(Guid streamId);

    IResult RegisterInputConsumer(Guid consumerId);

    void UnregisterInputConsumer(Guid consumerId);

    IResult<ChannelReader<Frame>> GetFramesChannel(Guid streamId);

    IResult<ChannelReader<PageProjectionDiff>> GetPageProjectionDiffsChannel(Guid streamId);

    IResult<ChannelReader<ConsoleOutput>> GetConsoleOutputChannel(Guid streamId);

    IResult<ChannelReader<SessionNotification>> GetNotificationChannel(Guid streamId);

    IResult<Task> StartVideoStreamingInputPump(
        Guid consumerId,
        ChannelReader<VideoStreamingInput> channelReader,
        CancellationToken ct);

    IResult<Task> StartConsoleInputPump(
        Guid consumerId,
        ChannelReader<ConsoleInput> channelReader,
        CancellationToken ct);
}
