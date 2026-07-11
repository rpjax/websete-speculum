using System.Threading.Channels;
using Websete.Speculum.Host.Virtualization.Models;
using Websete.Speculum.Host.Virtualization.Persistence;

namespace Websete.Speculum.Host.Virtualization.Contracts;

public interface IVSession
{
    Task StartAsync(CancellationToken ct = default);
    Task StopAsync(CancellationToken ct = default);
    Task CaptureAndPersistAsync(string cookieId, IProfileSnapshotMerger merger, CancellationToken ct = default);

    string? CookieId { get; set; }

    ChannelReader<Frame>         GetFrameReader();
    ChannelReader<ConsoleOutput> GetConsoleOutputReader();
    ChannelReader<SessionStatus> GetStatusReader();
    Task ConsumeUserInputAsync(ChannelReader<UserInput> channelReader);
    Task ConsumeConsoleInputAsync(ChannelReader<ConsoleInput> channelReader);

    Task NavigateAsync(string url, CancellationToken ct = default);
    Task ResizeAsync(int width, int height, CancellationToken ct = default);
}
