using System.Threading.Channels;
using Speculum.Api.BrowserPersistence;
using Speculum.Api.Diagnostics.Abstractions;
using Speculum.Api.Motor.Live.Models;

namespace Speculum.Api.Motor.Live;

public interface IMotorSession
{
    Task StartAsync(CancellationToken ct = default);
    Task StopAsync(CancellationToken ct = default);
    /// <summary>Exports sidecar state and persists it. Returns the exported payload when export ran.</summary>
    Task<BrowserStatePayload?> CaptureAndPersistAsync(
        string sessionId, IBrowserSessionStore store, CancellationToken ct = default);

    string? PersistedSessionId { get; set; }
    string SidecarSessionId { get; }
    string? CorrelationId { get; set; }
    string? ClientToken { get; set; }
    string ConnectionId { get; set; }

    void MarkPhase(MotorSessionPhase phase);
    MotorSessionDiagnosticsSnapshot GetDiagnosticsSnapshot();
    Task<object> RequestDiagnosticsProbeAsync(
        IReadOnlyList<string> ops,
        string? evaluateExpression,
        string? domSelector,
        int? maxProbeResponseBytes = null,
        CancellationToken ct = default);

    ChannelReader<Frame>         GetFrameReader();
    ChannelReader<ConsoleOutput> GetConsoleOutputReader();
    ChannelReader<SessionStatus> GetStatusReader();
    Task ConsumeUserInputAsync(ChannelReader<string> channelReader);
    Task ConsumeConsoleInputAsync(ChannelReader<ConsoleInput> channelReader);

    Task NavigateAsync(string url, CancellationToken ct = default);
    Task<ResizeResult> ResizeAsync(int width, int height, DeviceProfile? device = null, CancellationToken ct = default);
}
