using System.Threading.Channels;
using Speculum.Api.BrowserPersistence;
using Speculum.Api.Motor.Live.Models;

namespace Speculum.Api.Motor.Live;

public interface IMotorSession
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
