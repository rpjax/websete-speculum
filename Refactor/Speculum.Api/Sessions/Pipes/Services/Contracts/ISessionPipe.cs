using System.Threading.Channels;
using Aidan.Core.Patterns;
using Speculum.Api.Sessions.Models;

namespace Speculum.Api.Sessions.Pipes.Services.Contracts;

/// <summary>
/// Per-consumer I/O handle over a live session (frames, console, notifications, input pumps).
/// </summary>
/// <remarks>
/// <para>
/// Obtained from <see cref="ISessionPipeService.OpenPipeAsync"/>. Many pipes may share one
/// session / sidecar connection; this type is the caller's private stream gate, not the
/// connection itself.
/// </para>
/// <para>
/// After <see cref="ISessionPipeService.ClosePipe"/>, the instance remains usable only as a
/// zombie: channel/input methods return <c>IResult</c> Failure. There is no public
/// <c>Close</c> — only the pipe service may close a pipe.
/// </para>
/// <para>
/// Outbound streams (frames, console, notifications) are typically broadcast to all pipes of
/// the session. Status is not a stream — callers poll <see cref="GetStatusAsync"/>.
/// Inbound input policy (exclusive vs any-writer) is defined by the implementation / fan-out layer.
/// </para>
/// </remarks>
public interface ISessionPipe
{
    /// <summary>Stable id of this consumer pipe (minted by <c>OpenPipeAsync</c>).</summary>
    Guid Id { get; }

    /// <summary>Live session this pipe is bound to.</summary>
    Guid SessionId { get; }

    /// <summary>
    /// Screencast / frame stream for this pipe.
    /// </summary>
    IResult<ChannelReader<Frame>> GetFramesChannel();

    /// <summary>
    /// Browser console output stream for this pipe.
    /// </summary>
    IResult<ChannelReader<ConsoleOutput>> GetConsoleOutputChannel();

    /// <summary>
    /// Informative session notifications (location, navigation blocked, editable focus, crash).
    /// </summary>
    IResult<ChannelReader<SessionNotification>> GetNotificationChannel();

    /// <summary>
    /// One-shot status snapshot for this session. Not a stream — poll as needed.
    /// </summary>
    Task<IResult<SessionStatus>> GetStatusAsync(CancellationToken ct = default);

    /// <summary>
    /// Pumps user input from <paramref name="channelReader"/> into the live session
    /// until the channel completes, <paramref name="ct"/> cancels, or the pipe is closed.
    /// </summary>
    IResult<Task> ConsumeUserInputAsync(
        ChannelReader<string> channelReader,
        CancellationToken ct = default);

    /// <summary>
    /// Pumps console input from <paramref name="channelReader"/> into the live session
    /// until the channel completes, <paramref name="ct"/> cancels, or the pipe is closed.
    /// </summary>
    IResult<Task> ConsumeConsoleInputAsync(
        ChannelReader<ConsoleInput> channelReader,
        CancellationToken ct = default);
}
