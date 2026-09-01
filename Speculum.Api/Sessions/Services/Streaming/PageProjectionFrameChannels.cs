using System.Threading.Channels;

namespace Speculum.Api.Sessions.Services.Streaming;

/// <summary>
/// Bounded Wait-mode channels for PageProjection frame transport (M3).
/// .NET never drops motor payloads — backpressure is reported via <see cref="ConsumerPressureReporter"/>.
/// </summary>
internal static class PageProjectionFrameChannels
{
    /// <summary>
    /// Sidecar→API connection queue depth. Matches sidecar EventBridge Dom default (BZ1).
    /// </summary>
    public const int DefaultConnectionCapacity = 8192;

    /// <summary>
    /// Per-pipe fan-out buffer toward the consumer wire. Must stay ≪ connection capacity so
    /// a stalled consumer back-pressures the connection queue quickly.
    /// </summary>
    public const int FanOutTargetCapacity = 256;

    /// <summary>Sidecar→API connection queue. Full → Wait (blocks Watch pump).</summary>
    public static Channel<T> CreateConnectionQueue<T>(int capacity = DefaultConnectionCapacity)
        => Channel.CreateBounded<T>(new BoundedChannelOptions(capacity)
        {
            FullMode = BoundedChannelFullMode.Wait,
            SingleReader = false,
            SingleWriter = false,
        });

    /// <summary>Per-stream fan-out target. Full → Wait (blocks fan-out pump).</summary>
    public static Channel<T> CreateFanOutTarget<T>(int capacity = FanOutTargetCapacity)
        => Channel.CreateBounded<T>(new BoundedChannelOptions(capacity)
        {
            FullMode = BoundedChannelFullMode.Wait,
            SingleReader = true,
            SingleWriter = false,
        });
}
