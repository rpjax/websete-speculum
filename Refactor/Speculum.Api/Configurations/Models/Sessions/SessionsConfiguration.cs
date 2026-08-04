namespace Speculum.Api.Configurations.Models.Sessions;

public class SessionsConfiguration
{
    public const string SectionName = "Sessions";

    public TimeSpan DetachedSessionTimeout { get; init; }
    public bool IsJsBridgeEnabled { get; set; }

    /// <summary>
    /// Data-plane carrier for frames/input/console. Default WebTransport.
    /// Projected to public client-config; clients pick it up after refresh.
    /// </summary>
    public DataStreamTransportKind DataStreamTransport { get; init; } =
        DataStreamTransportKind.WebTransport;

    public ViewportPolicy ViewportPolicy { get; set; } = new();
    public ClientEnvironmentPolicy ClientEnvironmentPolicy { get; init; } = new();
    public DeviceEmulationPolicy DeviceEmulationPolicy { get; init; } = new();
    public ScreencastPolicy ScreencastPolicy { get; init; } = new();
    public InputMultiplexingPolicy InputMultiplexingPolicy { get; init; } = new();
    public OutputMultiplexingPolicy OutputMultiplexingPolicy { get; init; } = new();
}
