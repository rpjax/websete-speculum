using Speculum.Api.Diagnostics.Configuration;
using Speculum.Api.Diagnostics.Probes;

namespace Speculum.Api.Tests.Telemetry;

public sealed class ApiProcessResourceProbeTests
{
    [Fact]
    public void Sample_populates_core_and_opt_in_fields()
    {
        var probe = new ApiProcessResourceProbe();
        var sample = probe.Sample(new TelemetryApiProcessOptions
        {
            Enabled = true,
            SampleIntervalMs = 100,
            IncludePrivateMemory = true,
            IncludeGc = true,
            IncludeThreadPool = true,
        });

        Assert.True(sample.UptimeSec >= 0);
        Assert.InRange(sample.CpuUsage, 0, 100);
        Assert.True(sample.MemoryUsed > 0);
        Assert.True(sample.ThreadCount > 0);
        Assert.True(sample.MemoryPrivate > 0);
        Assert.True(sample.GcHeap > 0);
        Assert.True(sample.GcGen0 >= 0);
        Assert.True(sample.ThreadPoolBusy >= 0);
        Assert.True(sample.ThreadPoolQueued >= 0);
    }

    [Fact]
    public void Sample_omits_opt_ins_when_disabled()
    {
        var probe = new ApiProcessResourceProbe();
        var sample = probe.Sample(new TelemetryApiProcessOptions
        {
            SampleIntervalMs = 100,
            IncludePrivateMemory = false,
            IncludeGc = false,
            IncludeThreadPool = false,
        });

        Assert.Null(sample.MemoryPrivate);
        Assert.Null(sample.GcHeap);
        Assert.Null(sample.ThreadPoolBusy);
    }

    [Fact]
    public void Sample_is_cached_within_min_interval()
    {
        var probe = new ApiProcessResourceProbe();
        var options = new TelemetryApiProcessOptions { SampleIntervalMs = 60_000 };

        var first = probe.Sample(options);
        var second = probe.Sample(options);

        Assert.Equal(first.MemoryUsed, second.MemoryUsed);
        Assert.Equal(first.UptimeSec, second.UptimeSec);
    }
}

public sealed class MachineResourceProbeTests
{
    [Fact]
    public void Sample_returns_core_shape()
    {
        var probe = new MachineResourceProbe();
        var sample = probe.Sample(new TelemetryHostOptions
        {
            SampleIntervalMs = 100,
            IncludeLoadAverage = true,
            IncludeSwap = true,
            IncludeDiskIo = true,
            IncludeNetwork = true,
        });

        Assert.False(string.IsNullOrWhiteSpace(sample.Hostname));
        Assert.Contains(sample.Source, new[] { "machine", "cgroup", "unavailable" });
        Assert.True(sample.CpuCount >= 1);
        Assert.True(sample.DiskFreeBytes >= 0);
        Assert.True(sample.DiskTotalBytes >= 0);
        Assert.InRange(sample.CpuUsage, 0, 100);
    }

    [Fact]
    public void Sample_omits_opt_ins_when_disabled()
    {
        var probe = new MachineResourceProbe();
        var sample = probe.Sample(new TelemetryHostOptions
        {
            SampleIntervalMs = 100,
            IncludeLoadAverage = false,
            IncludeSwap = false,
            IncludeDiskIo = false,
            IncludeNetwork = false,
        });

        Assert.Null(sample.LoadAverage1m);
        Assert.Null(sample.SwapUsed);
        Assert.Null(sample.DiskReadBytesPerSec);
        Assert.Null(sample.NetworkRxBytesPerSec);
    }

    [Fact]
    public void Sample_is_cached_within_min_interval()
    {
        var probe = new MachineResourceProbe();
        var options = new TelemetryHostOptions { SampleIntervalMs = 60_000 };

        var first = probe.Sample(options);
        var second = probe.Sample(options);

        Assert.Equal(first.Hostname, second.Hostname);
        Assert.Equal(first.Source, second.Source);
        Assert.Equal(first.MemoryTotal, second.MemoryTotal);
    }
}
