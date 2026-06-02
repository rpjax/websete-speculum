using System.Threading.Channels;
using Websete.Speculum.Host.Virtualization.Models;

namespace Websete.Speculum.Host.Virtualization.Contracts;

public interface IVSession
{
    // lifecicle
    Task StartAsync(CancellationToken ct = default);
    Task StopAsync(CancellationToken ct = default);

    // channels
    ChannelReader<Frame> GetFrameReader();
    ChannelReader<ConsoleOutput> GetConsoleOutputReader();
    void ConsumeUserInput(ChannelReader<UserInput> channelReader);
    void ConsumeConsoleInput(ChannelReader<ConsoleInput> channelReader);

    // control methods
    Task NavigateAsync(string url, CancellationToken ct = default);
    Task ResizeAsync(int width, int height, CancellationToken ct = default);
}
