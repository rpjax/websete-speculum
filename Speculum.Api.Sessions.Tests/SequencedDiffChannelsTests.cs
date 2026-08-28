using System.Threading.Channels;
using Speculum.Api.Sessions.Mirror.PageProjection;
using Speculum.Api.Sessions.Services.Streaming;

namespace Speculum.Api.Sessions.Tests;

public sealed class SequencedDiffChannelsTests
{
    [Fact]
    public void TryWriteDropAllOnOverflow_DrainsBacklogThenKeepsNewest()
    {
        var channel = SequencedDiffChannels.Create<PageProjectionFrame>(capacity: 2);
        Assert.True(SequencedDiffChannels.TryWriteDropAllOnOverflow(channel, 2, Diff(1)));
        Assert.True(SequencedDiffChannels.TryWriteDropAllOnOverflow(channel, 2, Diff(2)));

        Assert.True(
            SequencedDiffChannels.TryWriteDropAllOnOverflow(
                channel,
                2,
                Diff(3),
                out var dropped,
                out var lowest,
                out var highest));

        Assert.Equal(2, dropped);
        Assert.Equal(1, lowest);
        Assert.Equal(2, highest);
        Assert.True(channel.Reader.TryRead(out var kept));
        Assert.Equal(3, kept.Sequence);
        Assert.False(channel.Reader.TryRead(out _));
    }

    [Fact]
    public async Task FanOutTarget_WriteAsyncWaitsUntilConsumerReads()
    {
        var channel = SequencedDiffChannels.CreateForFanOutTarget<PageProjectionFrame>(capacity: 1);
        Assert.True(channel.Writer.TryWrite(Diff(1)));

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        var writeTask = channel.Writer.WriteAsync(Diff(2), cts.Token).AsTask();

        await Task.Delay(50);
        Assert.False(writeTask.IsCompleted);

        Assert.True(channel.Reader.TryRead(out var first));
        Assert.Equal(1, first.Sequence);

        await writeTask;
        Assert.True(channel.Reader.TryRead(out var second));
        Assert.Equal(2, second.Sequence);
    }

    [Fact]
    public async Task FanOutTarget_DoesNotDropAllWhenFull()
    {
        var channel = SequencedDiffChannels.CreateForFanOutTarget<PageProjectionFrame>(capacity: 2);
        Assert.True(channel.Writer.TryWrite(Diff(1)));
        Assert.True(channel.Writer.TryWrite(Diff(2)));

        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(80));
        var blocked = channel.Writer.WriteAsync(Diff(3), cts.Token).AsTask();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => blocked);

        Assert.True(channel.Reader.TryRead(out var a));
        Assert.True(channel.Reader.TryRead(out var b));
        Assert.Equal(1, a.Sequence);
        Assert.Equal(2, b.Sequence);
        Assert.False(channel.Reader.TryRead(out _));
    }

    [Fact]
    public void FanOutTargetCapacity_IsMuchSmallerThanConnectionDefault()
    {
        // Closes the Wait@DefaultCapacity blind zone (WIRE_STALL_AT_8192).
        Assert.True(SequencedDiffChannels.FanOutTargetCapacity < SequencedDiffChannels.DefaultCapacity / 8);
        Assert.True(SequencedDiffChannels.FanOutTargetCapacity >= 32);
    }

    /// <summary>
    /// Stalled fan-out consumer + continued connection enqueue must DropAll on the
    /// connection queue (T5) — never silently buffer FR−WD inside a large Wait pipe.
    /// </summary>
    [Fact]
    public async Task StalledFanOut_BackpressuresConnection_IntoDropAll()
    {
        const int connectionCap = 4;
        const int fanOutCap = 2;
        var connection = SequencedDiffChannels.Create<PageProjectionFrame>(capacity: connectionCap);
        var fanOut = SequencedDiffChannels.CreateForFanOutTarget<PageProjectionFrame>(capacity: fanOutCap);

        using var lifetime = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        var fanOutFull = false;
        var dropAllSeen = false;

        // Consumer never reads fanOut — mimics stalled data-plane WD pump.
        var fanOutPump = Task.Run(async () =>
        {
            await foreach (var item in connection.Reader.ReadAllAsync(lifetime.Token))
            {
                if (!fanOut.Writer.TryWrite(item))
                {
                    fanOutFull = true;
                    using var shortWait = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
                    shortWait.CancelAfter(20);
                    try
                    {
                        await fanOut.Writer.WriteAsync(item, shortWait.Token);
                    }
                    catch (OperationCanceledException)
                    {
                        // Item already dequeued from connection; stall holds the pump.
                        await Task.Delay(Timeout.Infinite, lifetime.Token);
                    }
                }
            }
        }, lifetime.Token);

        for (var seq = 1L; seq <= 32; seq++)
        {
            var (dropped, _, _) = await SequencedDiffChannels
                .WriteDropAllOnOverflowDetailedAsync(connection, connectionCap, Diff(seq), lifetime.Token);
            if (dropped > 0)
            {
                dropAllSeen = true;
                break;
            }

            await Task.Delay(15);
        }

        lifetime.Cancel();
        try { await fanOutPump; } catch { /* cancelled */ }

        Assert.True(
            dropAllSeen,
            "connection DropAll must fire once fan-out Wait blocks (T5; no silent FR≫WD)");
        Assert.True(fanOutFull, "fan-out must have reached capacity before DropAll");
        Assert.True(
            SequencedDiffChannels.FanOutTargetCapacity <= 256,
            "production fan-out must stay small enough that Beleza-scale FR−WD cannot hide");
    }

    private static PageProjectionFrame Diff(long sequence) => new()
    {
        Sequence = sequence,
        Generation = 1,
        Plane = "dom",
        Operation = "childList",
    };
}
