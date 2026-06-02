using System.Threading.Channels;
using Websete.Speculum.Host.Virtualization.Models;

namespace Websete.Speculum.Host.Virtualization.Contracts;

public interface IVSession
{
    // lifecicle
    Task StartAsync(CancellationToken ct = default);
    Task StopAsync(CancellationToken ct = default);

    // channels
    ChannelReader<Frame>         GetFrameReader();
    ChannelReader<ConsoleOutput> GetConsoleOutputReader();

    /// <summary>
    /// Periodic session health snapshots (every 1 s).
    /// Carries tab count, FPS, uptime, URL and other diagnostics.
    /// Delivered via a separate SignalR stream so the frame and console
    /// channels are completely unaffected.
    /// </summary>
    ChannelReader<SessionStatus> GetStatusReader();
    /// <summary>
    /// Starts pumping input events from <paramref name="channelReader"/> to the sidecar.
    /// Returns a <see cref="Task"/> that completes when the stream ends or the session stops.
    /// The caller (SignalR hub) must await this task so the streaming invocation stays alive.
    /// </summary>
    Task ConsumeUserInputAsync(ChannelReader<UserInput> channelReader);

    /// <summary>
    /// Starts pumping evaljs commands from <paramref name="channelReader"/> to the sidecar.
    /// Returns a <see cref="Task"/> that completes when the stream ends or the session stops.
    /// </summary>
    Task ConsumeConsoleInputAsync(ChannelReader<ConsoleInput> channelReader);

    // control methods
    Task NavigateAsync(string url, CancellationToken ct = default);
    Task ResizeAsync(int width, int height, CancellationToken ct = default);
}
