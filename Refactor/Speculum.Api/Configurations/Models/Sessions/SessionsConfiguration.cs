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
  /// Admin-only projection mode for new sessions (Launch). Default VideoStreaming.
  /// Set only via Admin Configurations → Sessions. Projected to public client-config
  /// so the SPA mounts the definitive surface before StartSession; not chosen by the client.
  /// </summary>
  public MirrorMode MirrorMode { get; init; } = MirrorMode.VideoStreaming;

    /// <summary>
    /// Bounded PageProjection Diff queue depth (sidecar EventBridge Dom + API
    /// sequenced channels). Overflow still DropAll → client sequence_gap (T5/D13).
    /// Default matches <c>SequencedDiffChannels.DefaultCapacity</c>.
    /// </summary>
    /// <remarks>
    /// Obsolete as a load control (<c>docs/page-projection-engine-redesign.md</c> §5.16):
    /// backpressure is now the frame-rate ladder in <see cref="PageProjection"/>, which
    /// never drops a frame. This property is kept only to size the transport queue itself.
    /// </remarks>
    public int PageProjectionDiffQueueCapacity { get; init; } = 8192;

    /// <summary>PageProjection engine configuration surface (§5.16).</summary>
    public PageProjectionOptions PageProjection { get; init; } = new();

    public ViewportPolicy ViewportPolicy { get; set; } = new();
    public ClientEnvironmentPolicy ClientEnvironmentPolicy { get; init; } = new();
    public DeviceEmulationPolicy DeviceEmulationPolicy { get; init; } = new();
    public ScreencastPolicy ScreencastPolicy { get; init; } = new();
    public InputMultiplexingPolicy InputMultiplexingPolicy { get; init; } = new();
    public OutputMultiplexingPolicy OutputMultiplexingPolicy { get; init; } = new();
}
