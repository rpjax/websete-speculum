using System.Threading.Channels;
using Speculum.Api.Sessions.Mirror.PageProjection;
using Speculum.Api.Sessions.Models;

namespace Speculum.Api.Sessions.Services.Streaming;

/// <summary>
/// Per-pipe outbound channels (fan-out targets + consumer readers).
/// </summary>
internal sealed class PipeStreamChannels
{
    public PipeStreamChannels(
        Channel<Frame> frames,
        Channel<PageProjectionDiff> domDiffs,
        Channel<ConsoleOutput> console,
        Channel<SessionNotification> notifications)
    {
        Frames = frames;
        PageProjectionDiffs = domDiffs;
        Console = console;
        Notifications = notifications;
    }

    public Channel<Frame> Frames { get; }
    public Channel<PageProjectionDiff> PageProjectionDiffs { get; }
    public Channel<ConsoleOutput> Console { get; }
    public Channel<SessionNotification> Notifications { get; }

    public void Complete()
    {
        Frames.Writer.TryComplete();
        PageProjectionDiffs.Writer.TryComplete();
        Console.Writer.TryComplete();
        Notifications.Writer.TryComplete();
    }
}
