using System.Threading.Channels;
using Aidan.Core.Patterns;
using Speculum.Api.Sessions.Models;

namespace Speculum.Api.Sessions.Services.Contracts;

/// <summary>
/// Per-consumer I/O handle over a live session (frames, console, status, input pumps).
/// </summary>
/// <remarks>
/// <para>
/// Obtained from <see cref="ISessionPipeService.OpenPipe"/>. Many pipes may share one
/// session / sidecar connection; this type is the caller's private stream gate, not the
/// connection itself.
/// </para>
/// <para>
/// After <see cref="ISessionPipeService.ClosePipe"/>, the instance remains usable only as a
/// zombie: channel/input methods return <c>IResult</c> Failure. There is no public
/// <c>Close</c> — only the pipe service may close a pipe.
/// </para>
/// <para>
/// Outbound streams are typically broadcast to all pipes of the session. Inbound input
/// policy (exclusive vs any-writer) is defined by the implementation / fan-out layer.
/// </para>
/// </remarks>
public interface ISessionPipe
{
    /// <summary>Stable id of this consumer pipe (same as passed to <c>OpenPipe</c>).</summary>
    Guid Id { get; }

    /// <summary>Live session this pipe is bound to.</summary>
    Guid SessionId { get; }

    /// <summary>
    /// Screencast / frame stream for this pipe.
    /// </summary>
    /// <returns>
    /// Success with a reader, or Failure if the pipe is closed.
    /// </returns>
    IResult<ChannelReader<Frame>> GetFramesChannel();

    /// <summary>
    /// Browser console output stream for this pipe.
    /// </summary>
    /// <returns>
    /// Success with a reader, or Failure if the pipe is closed.
    /// </returns>
    IResult<ChannelReader<ConsoleOutput>> GetConsoleOutputChannel();

    /// <summary>
    /// Session status / lifecycle signals visible to this consumer.
    /// </summary>
    /// <returns>
    /// Success with a reader, or Failure if the pipe is closed.
    /// </returns>
    IResult<ChannelReader<SessionStatus>> GetStatusChannel();

    /// <summary>
    /// Pumps user input from <paramref name="channelReader"/> into the live session
    /// until the channel completes, <paramref name="ct"/> cancels, or the pipe is closed.
    /// </summary>
    /// <returns>
    /// Success with the pump task, or Failure if the pipe is already closed.
    /// </returns>
    IResult<Task> ConsumeUserInputAsync(
        ChannelReader<string> channelReader,
        CancellationToken ct = default);

    /// <summary>
    /// Pumps console input from <paramref name="channelReader"/> into the live session
    /// until the channel completes, <paramref name="ct"/> cancels, or the pipe is closed.
    /// </summary>
    /// <returns>
    /// Success with the pump task, or Failure if the pipe is already closed.
    /// </returns>
    IResult<Task> ConsumeConsoleInputAsync(
        ChannelReader<ConsoleInput> channelReader,
        CancellationToken ct = default);
}
