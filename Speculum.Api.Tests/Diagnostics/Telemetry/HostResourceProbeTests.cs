using Speculum.Api.Diagnostics.Probes;

namespace Speculum.Api.Tests.Telemetry;

public sealed class HostResourceProbeTests
{
    [Fact]
    public void Sample_populates_enriched_fields()
    {
        var probe = new HostResourceProbe();

        var sample = probe.Sample(minIntervalMs: 0);

        Assert.False(string.IsNullOrWhiteSpace(sample.Hostname));
        Assert.True(sample.UptimeSec >= 0);
        Assert.InRange(sample.CpuUsage, 0, 100);
        Assert.True(sample.MemoryUsed > 0);
        Assert.True(sample.MemoryPrivate > 0);
        Assert.True(sample.MemoryTotal > 0);
        Assert.True(sample.GcHeap > 0);
        Assert.True(sample.GcGen0 >= 0);
        Assert.True(sample.ThreadCount > 0);
        Assert.True(sample.ThreadPoolBusy >= 0);
        Assert.True(sample.ThreadPoolQueued >= 0);
        Assert.True(sample.DiskFreeBytes >= 0);
    }

    [Fact]
    public void Sample_is_cached_within_min_interval()
    {
        var probe = new HostResourceProbe();

        var first = probe.Sample(minIntervalMs: 60_000);
        var second = probe.Sample(minIntervalMs: 60_000);

        // Same cached instance returned within the interval window.
        Assert.Same(first, second);
    }

    [Fact]
    public void Sample_refreshes_after_interval_elapses()
    {
        var probe = new HostResourceProbe();

        var first = probe.Sample(minIntervalMs: 0);
        var second = probe.Sample(minIntervalMs: 0);

        Assert.NotSame(first, second);
    }
}
