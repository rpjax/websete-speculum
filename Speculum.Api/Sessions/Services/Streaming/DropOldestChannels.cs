using System.Threading.Channels;

namespace Speculum.Api.Sessions.Services.Streaming;

/// <summary>
/// Bounded DropOldest channels for stream pumps (outbound fan-out and inbound WT).
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
