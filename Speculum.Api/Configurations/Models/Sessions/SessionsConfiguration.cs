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

  /// <summary>
  /// Admin-only projection mode for new sessions (Launch). Default <see cref="MirrorMode.PageProjection"/>
  /// (product). <see cref="MirrorMode.VideoStreaming"/> remains as a legacy path until removed.
  /// Set via Admin Configurations → Sessions (or <c>Sessions__MirrorMode</c> on first-boot).
  /// Projected to public client-config so the SPA mounts the surface before StartSession;
  /// not chosen by the client.
  /// </summary>
  public MirrorMode MirrorMode { get; init; } = MirrorMode.PageProjection;

    /// <summary>
    /// Enable CDP CPU profiling RPCs on the Virtual Chromium (lab/diag). Default false.
    /// </summary>
    public bool CpuProfiling { get; init; }

    /// <summary>
    /// Emit PageProjection input path hops from sidecar (Launch-injected; zero cost when false). Default false.
    /// </summary>
    public bool InputPathTelemetry { get; init; }

    /// <summary>
    /// Bounded PageProjection frame transport queue (sidecar EventBridge Dom + API
    /// connection Wait channel). M3: .NET never drops — overflow reports ConsumerPressure.
    /// Default matches <c>PageProjectionFrameChannels.DefaultConnectionCapacity</c>.
    /// </summary>
    /// <remarks>
    /// Obsolete as a load control (<c>docs/page-projection/spec/engine-redesign.md</c> §5.16):
    /// backpressure is reported to the motor via Control <c>consumer_pressure</c>.
    /// This property sizes the API connection Wait queue only.
    /// </remarks>
    public int FrameQueueCapacity { get; init; } = 8192;

    /// <summary>PageProjection engine configuration surface (§5.16).</summary>
    public PageProjectionOptions PageProjection { get; init; } = new();

    public ViewportPolicy ViewportPolicy { get; set; } = new();
    public ClientEnvironmentPolicy ClientEnvironmentPolicy { get; init; } = new();
    public DeviceEmulationPolicy DeviceEmulationPolicy { get; init; } = new();
    public ScreencastPolicy ScreencastPolicy { get; init; } = new();
    public InputMultiplexingPolicy InputMultiplexingPolicy { get; init; } = new();
    public OutputMultiplexingPolicy OutputMultiplexingPolicy { get; init; } = new();
}
