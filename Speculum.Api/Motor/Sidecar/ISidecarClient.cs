using System.Threading.Channels;
using Speculum.Api.BrowserPersistence;

namespace Speculum.Api.Motor.Sidecar;

public interface ISidecarClient : IAsyncDisposable
{
    string SessionId { get; }
    ChannelReader<ReadOnlyMemory<byte>> VideoChannel { get; }
    ChannelReader<ReadOnlyMemory<byte>> ControlChannel { get; }

    Task ConnectAsync(
        string                        sidecarBaseUrl,
        int                           width,
        int                           height,
        string?                       initialUrl               = null,
        BrowserStatePayload?          browserState             = null,
        IReadOnlyList<ScriptPayload>? scripts                  = null,
        bool                          jsBridgeEnabled          = false,
        IReadOnlyList<string>?        allowedNavigationDomains = null,
        Speculum.Api.Motor.Live.DeviceProfile? device          = null,
        CancellationToken             ct                       = default);

    Task<BrowserStatePayload> RequestStateExportAsync(CancellationToken ct = default);
    Task<object> RequestDiagnosticsAsync(
        IReadOnlyList<string> ops,
        string? evaluateExpression = null,
        string? domSelector = null,
        int? maxProbeResponseBytes = null,
        CancellationToken ct = default);

    /// <summary>Send correlated <c>resize</c> and await <c>resizeResult</c>.</summary>
    Task<SidecarResizeResult> RequestResizeAsync(
        string requestId,
        int width,
        int height,
        Speculum.Api.Motor.Live.DeviceProfile device,
        CancellationToken ct = default);

    Task SendInputAsync(ReadOnlyMemory<byte> raw, CancellationToken ct = default);
}
