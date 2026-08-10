using System.Threading.Channels;
using Speculum.Api.Sessions.Mirror.PageProjection;

namespace Speculum.Api.Sessions.Services.Streaming;

/// <summary>
/// Bounded channels for sequenced PageProjection diffs (T5/D13).
/// Connection enqueue uses DropAll-on-overflow (gap → desync, never silent DropOldest chronology).
/// Per-pipe fan-out targets use Wait + WriteAsync — lossless push; backpressure to connection.
/// </summary>
internal static class SequencedDiffChannels
{
    /// <summary>Matches sidecar EventBridge Dom queue — SPA churn needs headroom before DropAll.</summary>
    public const int DefaultCapacity = 1024;

    /// <summary>
    /// Sidecar→API connection queue. Writers use <see cref="WriteDropAllOnOverflowDetailedAsync"/>.
    /// Wait (not DropOldest) so the safety net never silently truncates chronology.
    /// </summary>
    public static Channel<T> Create<T>(int capacity = DefaultCapacity)
        => Channel.CreateBounded<T>(new BoundedChannelOptions(capacity)
        {
            FullMode = BoundedChannelFullMode.Wait,
            SingleReader = false,
            SingleWriter = false,
        });

    /// <summary>
    /// Per-pipe fan-out target. Full → Wait so the fan-out pump blocks (active push) instead of
    /// DropAll wiping establish/early sequences still buffered for a slow data-plane consumer.
    /// Loss, if any, stays at the connection queue (<c>api_sequenced</c>).
    /// </summary>
    public static Channel<T> CreateForFanOutTarget<T>(int capacity = DefaultCapacity)
        => Channel.CreateBounded<T>(new BoundedChannelOptions(capacity)
        {
            FullMode = BoundedChannelFullMode.Wait,
            SingleReader = true,
            SingleWriter = false,
        });

    public static bool TryWriteDropAllOnOverflow<T>(Channel<T> channel, int capacity, T item)
        => TryWriteDropAllOnOverflow(channel, capacity, item, out _);

    /// <returns>True when a write was accepted; <paramref name="droppedCount"/> is backlog drained.</returns>
    public static bool TryWriteDropAllOnOverflow<T>(
        Channel<T> channel,
        int capacity,
        T item,
        out int droppedCount)
        => TryWriteDropAllOnOverflow(channel, capacity, item, out droppedCount, out _, out _);

    /// <returns>True when a write was accepted; reports drained count + sequence range when T is PageProjectionDiff.</returns>
    public static bool TryWriteDropAllOnOverflow<T>(
        Channel<T> channel,
        int capacity,
        T item,
        out int droppedCount,
        out long? lowestDroppedSequence,
        out long? highestDroppedSequence)
    {
        droppedCount = 0;
        lowestDroppedSequence = null;
        highestDroppedSequence = null;
        var reader = channel.Reader;
        if (reader.CanCount && reader.Count >= capacity)
        {
            while (reader.TryRead(out var drained))
            {
                droppedCount++;
                ObserveDroppedSequence(drained, ref lowestDroppedSequence, ref highestDroppedSequence);
            }
        }

        return channel.Writer.TryWrite(item);
    }

    public static async ValueTask WriteDropAllOnOverflowAsync<T>(
        Channel<T> channel,
        int capacity,
        T item,
        CancellationToken cancellationToken)
    {
        _ = await WriteDropAllOnOverflowCountedAsync(channel, capacity, item, cancellationToken)
            .ConfigureAwait(false);
    }

    /// <returns>Number of items drained before write (0 when no overflow).</returns>
    public static async ValueTask<int> WriteDropAllOnOverflowCountedAsync<T>(
        Channel<T> channel,
        int capacity,
        T item,
        CancellationToken cancellationToken)
    {
        var result = await WriteDropAllOnOverflowDetailedAsync(channel, capacity, item, cancellationToken)
            .ConfigureAwait(false);
        return result.DroppedCount;
    }

    public static async ValueTask<(
        int DroppedCount,
        long? LowestDroppedSequence,
        long? HighestDroppedSequence)> WriteDropAllOnOverflowDetailedAsync<T>(
        Channel<T> channel,
        int capacity,
        T item,
        CancellationToken cancellationToken)
    {
        var droppedCount = 0;
        long? lowest = null;
        long? highest = null;
        var reader = channel.Reader;
        if (reader.CanCount && reader.Count >= capacity)
        {
            while (reader.TryRead(out var drained))
            {
                droppedCount++;
                ObserveDroppedSequence(drained, ref lowest, ref highest);
            }
        }

        await channel.Writer.WriteAsync(item, cancellationToken).ConfigureAwait(false);
        return (droppedCount, lowest, highest);
    }

    private static void ObserveDroppedSequence<T>(
        T drained,
        ref long? lowest,
        ref long? highest)
    {
        if (drained is not PageProjectionDiff diff)
        {
            return;
        }

        var seq = diff.Sequence;
        if (lowest is null || seq < lowest.Value)
        {
            lowest = seq;
        }

        if (highest is null || seq > highest.Value)
        {
            highest = seq;
        }
    }
}
