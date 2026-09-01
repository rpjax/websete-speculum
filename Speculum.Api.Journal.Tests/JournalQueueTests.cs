using Speculum.Api.Journal.Models;

namespace Speculum.Api.Journal.Tests;

public sealed class JournalQueueTests
{
    [Fact]
    public async Task TakeBatchAsync_WakesAndRespectsMaxCount()
    {
        var (queue, _, _) = JournalTestHarness.CreateQueue(o => o.MaxBatchSize = 64);

        queue.Enqueue(JournalTestHarness.Entry());
        queue.Enqueue(JournalTestHarness.Entry());
        queue.Enqueue(JournalTestHarness.Entry());

        var batch = await queue.TakeBatchAsync(2);
        Assert.Equal(2, batch.Count);

        var rest = await queue.TakeBatchAsync(10);
        Assert.Single(rest);
        Assert.Equal(0, queue.Count);
    }

    [Fact]
    public void SoftDepth_DropsBestEffort_KeepsGuaranteed()
    {
        var (queue, metrics, _) = JournalTestHarness.CreateQueue(o =>
        {
            o.SoftQueueDepth = 1;
            o.HardQueueDepth = 100;
            o.MaxQueueDepth = 0;
        });

        queue.Enqueue(JournalTestHarness.Entry(PublishPolicy.Guaranteed));
        queue.Enqueue(JournalTestHarness.Entry(PublishPolicy.BestEffort));
        queue.Enqueue(JournalTestHarness.Entry(PublishPolicy.Guaranteed));

        Assert.Equal(2, queue.Count);
        Assert.True(metrics.DroppedOnEnqueue >= 1);
        Assert.Equal(2, metrics.Enqueued);
    }

    [Fact]
    public void SoftDepth_Zero_DisablesBestEffortShedding()
    {
        var (queue, metrics, _) = JournalTestHarness.CreateQueue(o =>
        {
            o.SoftQueueDepth = 0;
            o.HardQueueDepth = 0;
            o.MaxQueueDepth = 0;
        });

        queue.Enqueue(JournalTestHarness.Entry(PublishPolicy.BestEffort));
        queue.Enqueue(JournalTestHarness.Entry(PublishPolicy.BestEffort));

        Assert.Equal(2, queue.Count);
        Assert.Equal(0, metrics.DroppedOnEnqueue);
    }

    [Fact]
    public async Task HardDepth_RaisesQueuePressure_ClearsWhenDrained()
    {
        var (queue, metrics, health) = JournalTestHarness.CreateQueue(o =>
        {
            o.SoftQueueDepth = 100;
            o.HardQueueDepth = 2;
            o.MaxQueueDepth = 0;
        });

        queue.Enqueue(JournalTestHarness.Entry(PublishPolicy.Guaranteed));
        queue.Enqueue(JournalTestHarness.Entry(PublishPolicy.Guaranteed));
        Assert.Equal(JournalHealthState.Degraded, health.State);
        Assert.True(health.IsQueuePressureActive);
        Assert.False(health.IsPersistDegraded);
        Assert.Equal(1, metrics.HardDepthPressure);

        var batch = await queue.TakeBatchAsync(10);
        Assert.Equal(2, batch.Count);
        Assert.Equal(0, queue.Count);
        Assert.Equal(JournalHealthState.Healthy, health.State);
        Assert.False(health.IsQueuePressureActive);
    }

    [Fact]
    public void HardDepth_SoftZero_StillDropsBestEffort()
    {
        var (queue, metrics, health) = JournalTestHarness.CreateQueue(o =>
        {
            o.SoftQueueDepth = 0;
            o.HardQueueDepth = 2;
            o.MaxQueueDepth = 0;
        });

        queue.Enqueue(JournalTestHarness.Entry(PublishPolicy.Guaranteed));
        queue.Enqueue(JournalTestHarness.Entry(PublishPolicy.Guaranteed));
        Assert.Equal(JournalHealthState.Degraded, health.State);
        Assert.Equal(1, metrics.HardDepthPressure);

        queue.Enqueue(JournalTestHarness.Entry(PublishPolicy.BestEffort));
        Assert.Equal(2, queue.Count);
        Assert.Equal(1, metrics.DroppedOnEnqueue);

        queue.Enqueue(JournalTestHarness.Entry(PublishPolicy.Guaranteed));
        Assert.Equal(3, queue.Count);
        Assert.Equal(1, metrics.HardDepthPressure);
        Assert.Equal(1, metrics.DegradedEnter);
    }

    [Fact]
    public void MaxQueueDepth_RejectsGuaranteed()
    {
        var (queue, metrics, health) = JournalTestHarness.CreateQueue(o =>
        {
            o.SoftQueueDepth = 0;
            o.HardQueueDepth = 0;
            o.MaxQueueDepth = 1;
        });

        queue.Enqueue(JournalTestHarness.Entry(PublishPolicy.Guaranteed));
        queue.Enqueue(JournalTestHarness.Entry(PublishPolicy.Guaranteed));

        Assert.Equal(1, queue.Count);
        Assert.Equal(1, metrics.GuaranteedAdmissionFailures);
        Assert.True(health.IsPersistDegraded);
    }

    [Fact]
    public async Task TakeBatchAsync_ThrowsWhenCancelled()
    {
        var (queue, _, _) = JournalTestHarness.CreateQueue(o => o.MaxQueueDepth = 0);
        using var cts = new CancellationTokenSource();
        cts.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => queue.TakeBatchAsync(10, cts.Token).AsTask());
    }
}
