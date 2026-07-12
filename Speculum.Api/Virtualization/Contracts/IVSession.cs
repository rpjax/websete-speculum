using System.Threading.Channels;
using Speculum.Api.Virtualization.Models;
using Speculum.Api.Virtualization.Persistence;

namespace Speculum.Api.Virtualization.Contracts;

public interface IVSession
{
    Task StartAsync(CancellationToken ct = default);
    Task StopAsync(CancellationToken ct = default);
    Task CaptureAndPersistAsync(string sessionId, IBrowserSessionStore store, CancellationToken ct = default);

    string? PersistedSessionId { get; set; }

    ChannelReader<Frame>         GetFrameReader();
    ChannelReader<ConsoleOutput> GetConsoleOutputReader();
    ChannelReader<SessionStatus> GetStatusReader();
    Task ConsumeUserInputAsync(ChannelReader<string> channelReader);
    Task ConsumeConsoleInputAsync(ChannelReader<ConsoleInput> channelReader);

    Task NavigateAsync(string url, CancellationToken ct = default);
    Task ResizeAsync(int width, int height, CancellationToken ct = default);
}
