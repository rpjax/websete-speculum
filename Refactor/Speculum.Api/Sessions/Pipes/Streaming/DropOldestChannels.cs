using System.Threading.Channels;

namespace Speculum.Api.Sessions.Pipes.Streaming;

/// <summary>
/// Bounded DropOldest channels used for per-pipe outbound streams.
/// </summary>
internal static class DropOldestChannels
{
    public static Channel<T> Create<T>(int capacity)
        => Channel.CreateBounded<T>(new BoundedChannelOptions(capacity)
        {
            FullMode = BoundedChannelFullMode.DropOldest,
            SingleReader = false,
            SingleWriter = false,
        });
}
