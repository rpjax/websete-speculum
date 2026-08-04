using System.Threading.Channels;
using Speculum.Api.Sessions.Mirror.DomProjection;
using Speculum.Api.Sessions.Models;

namespace Speculum.Api.Sessions.Services.Streaming;

/// <summary>
/// Per-pipe outbound channels (fan-out targets + consumer readers).
/// </summary>
internal sealed class PipeStreamChannels
{
    public PipeStreamChannels(
        Channel<Frame> frames,
        Channel<DomDiff> domDiffs,
        Channel<ConsoleOutput> console,
        Channel<SessionNotification> notifications)
    {
        Frames = frames;
        DomDiffs = domDiffs;
        Console = console;
        Notifications = notifications;
    }

    public Channel<Frame> Frames { get; }
    public Channel<DomDiff> DomDiffs { get; }
    public Channel<ConsoleOutput> Console { get; }
    public Channel<SessionNotification> Notifications { get; }

    public void Complete()
    {
        Frames.Writer.TryComplete();
        DomDiffs.Writer.TryComplete();
        Console.Writer.TryComplete();
        Notifications.Writer.TryComplete();
    }
}
