using System.Threading.Channels;
using Speculum.Api.Sessions.Models;

namespace Speculum.Api.Sessions.Pipes.Streaming;

/// <summary>
/// Per-pipe outbound channels (fan-out targets + consumer readers).
/// </summary>
internal sealed class PipeStreamChannels
{
    public PipeStreamChannels(
        Channel<Frame> frames,
        Channel<ConsoleOutput> console,
        Channel<SessionNotification> notifications)
    {
        Frames = frames;
        Console = console;
        Notifications = notifications;
    }

    public Channel<Frame> Frames { get; }
    public Channel<ConsoleOutput> Console { get; }
    public Channel<SessionNotification> Notifications { get; }

    public void Complete()
    {
        Frames.Writer.TryComplete();
        Console.Writer.TryComplete();
        Notifications.Writer.TryComplete();
    }
}
