using Speculum.Api.Sessions.Services.Streaming;

namespace Speculum.Api.Sessions.Tests;

public sealed class ConsumerPressureReporterTests
{
    [Fact]
    public void ShouldReport_RateLimitsIdenticalSnapshots()
    {
        var reporter = new ConsumerPressureReporter();
        var snapshot = new ConsumerPressureSnapshot(10, 0, 100, false);

        Assert.True(reporter.ShouldReport(snapshot, nowUnixMs: 1000));
        Assert.False(reporter.ShouldReport(snapshot, nowUnixMs: 1100));
        Assert.True(reporter.ShouldReport(snapshot, nowUnixMs: 1000 + ConsumerPressureReporter.MinReportIntervalMs));
    }

    [Fact]
    public void ShouldReport_AllowsImmediateReportWhenPressureIncreases()
    {
        var reporter = new ConsumerPressureReporter();
        Assert.True(reporter.ShouldReport(new ConsumerPressureSnapshot(5, 0, 0, false), 1000));
        Assert.True(reporter.ShouldReport(new ConsumerPressureSnapshot(20, 0, 0, false), 1050));
    }

    [Fact]
    public void ShouldReport_SkipsZeroPressureWhenNotDraining()
    {
        var reporter = new ConsumerPressureReporter();
        Assert.False(reporter.ShouldReport(new ConsumerPressureSnapshot(0, 0, 0, false), 1000));
    }
}
