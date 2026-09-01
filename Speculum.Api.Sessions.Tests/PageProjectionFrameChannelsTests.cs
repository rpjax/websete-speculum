using System.Threading.Channels;
using Speculum.Api.Sessions.Mirror.PageProjection;
using Speculum.Api.Sessions.Services.Streaming;

namespace Speculum.Api.Sessions.Tests;

public sealed class PageProjectionFrameChannelsTests
{
    [Fact]
    public async Task FanOutTarget_WriteAsyncWaitsUntilConsumerReads()
    {
        var channel = PageProjectionFrameChannels.CreateFanOutTarget<PageProjectionFrame>(capacity: 1);
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
    public async Task FanOutTarget_DoesNotDropWhenFull()
    {
        var channel = PageProjectionFrameChannels.CreateFanOutTarget<PageProjectionFrame>(capacity: 2);
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
        Assert.True(PageProjectionFrameChannels.FanOutTargetCapacity < PageProjectionFrameChannels.DefaultConnectionCapacity / 8);
        Assert.True(PageProjectionFrameChannels.FanOutTargetCapacity >= 32);
    }

    [Fact]
    public async Task ConnectionQueue_WaitBlocksWriterWithoutDropping()
    {
        var channel = PageProjectionFrameChannels.CreateConnectionQueue<PageProjectionFrame>(capacity: 2);
        Assert.True(channel.Writer.TryWrite(Diff(1)));
        Assert.True(channel.Writer.TryWrite(Diff(2)));

        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(80));
        var blocked = channel.Writer.WriteAsync(Diff(3), cts.Token).AsTask();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => blocked);

        Assert.Equal(2, channel.Reader.Count);
        Assert.True(channel.Reader.TryRead(out _));
        Assert.True(channel.Reader.TryRead(out _));
    }

    private static PageProjectionFrame Diff(long sequence) => new()
    {
        Sequence = sequence,
        Generation = 1,
        Plane = "dom",
        Operation = "childList",
    };
}
