using Speculum.Api.ResourceMonitoring.Models;
using Speculum.Api.ResourceMonitoring.Services;
using Speculum.Api.Telemetry.Events.Models.Sampling;
using Speculum.Api.Telemetry.Models;

namespace Speculum.Api.Telemetry.Tests;

public sealed class ResourceSignalDetectorTests
{
    [Fact]
    public void Detects_api_memory_leak_when_memory_rises_and_live_sessions_flat()
    {
        var now = DateTimeOffset.Parse("2026-08-02T12:00:00Z");
        var window = new List<(Guid, DateTimeOffset, SampleCollected)>();
        for (var i = 0; i < 5; i++)
        {
            window.Add((
                Guid.NewGuid(),
                now.AddMinutes(i),
                Sample(
                    apiMem: (100 + i * 40L) * 1024 * 1024,
                    live: 2,
                    hostCpu: 20)));
        }

        var signals = ResourceSignalDetector.Evaluate(window, now.AddMinutes(5));
        Assert.Contains(signals, s => s.Kind == ResourceSignalKind.ApiMemoryLeak);
    }

    [Fact]
    public void Does_not_flag_leak_when_live_sessions_change()
    {
        var now = DateTimeOffset.Parse("2026-08-02T12:00:00Z");
        var window = new List<(Guid, DateTimeOffset, SampleCollected)>
        {
            (Guid.NewGuid(), now, Sample(apiMem: 100 * 1024 * 1024, live: 1, hostCpu: 10)),
            (Guid.NewGuid(), now.AddMinutes(1), Sample(apiMem: 200 * 1024 * 1024, live: 1, hostCpu: 10)),
            (Guid.NewGuid(), now.AddMinutes(2), Sample(apiMem: 300 * 1024 * 1024, live: 5, hostCpu: 10)),
        };

        var signals = ResourceSignalDetector.Evaluate(window, now.AddMinutes(3));
        Assert.DoesNotContain(signals, s => s.Kind == ResourceSignalKind.ApiMemoryLeak);
    }

    [Fact]
    public void Detects_host_saturation_on_sustained_high_cpu()
    {
        var now = DateTimeOffset.Parse("2026-08-02T12:00:00Z");
        var window = Enumerable.Range(0, 3)
            .Select(i => (
                Guid.NewGuid(),
                now.AddMinutes(i),
                Sample(apiMem: 50 * 1024 * 1024, live: 1, hostCpu: 92)))
            .ToList();

        var signals = ResourceSignalDetector.Evaluate(window, now.AddMinutes(3));
        Assert.Contains(signals, s => s.Kind == ResourceSignalKind.HostSaturation);
    }

    private static SampleCollected Sample(long apiMem, int live, double hostCpu)
        => new(
            new HostTelemetry(
                "h", "machine", 1, hostCpu, 4,
                8L * 1024 * 1024 * 1024, 2L * 1024 * 1024 * 1024, 16L * 1024 * 1024 * 1024,
                100, 200, null, null, null, null, null, null, null, null, null),
            new ApiProcessTelemetry(1, 5, apiMem, 20, null, null, null, null, null, null, null),
            new SessionsTelemetry(live, live, 10, live * 10.0, 30, 20, 40, null, null),
            null, null, null, null);
}

public sealed class ResourceHistoryBucketTests
{
    [Fact]
    public void Bucket_collapses_points_per_interval()
    {
        var t0 = DateTimeOffset.Parse("2026-08-02T12:00:00Z");
        var items = Enumerable.Range(0, 10)
            .Select(i => new ResourceHistoryItem
            {
                Id = Guid.NewGuid(),
                Sequence = i + 1,
                PublishedAt = t0.AddSeconds(i * 10),
                Sample = new SampleCollected(null, null, null, null, null, null, null),
            })
            .ToList();

        var bucketed = ResourceHistoryService.Bucket(items, bucketSeconds: 30, maxBuckets: 100);
        Assert.True(bucketed.Count < items.Count);
        Assert.True(bucketed.Count >= 3);
    }
}

public sealed class ResourceReportMaterializerTests
{
    [Fact]
    public void ResourceTrend_builds_overview_chapter()
    {
        var from = DateTimeOffset.Parse("2026-08-02T11:00:00Z");
        var to = DateTimeOffset.Parse("2026-08-02T12:00:00Z");
        var samples = new List<ResourceHistoryItem>
        {
            new()
            {
                Id = Guid.NewGuid(),
                Sequence = 1,
                PublishedAt = from,
                Sample = new SampleCollected(
                    new HostTelemetry("h", "machine", 1, 40, 4, 1, 1, 2, 1, 2,
                        null, null, null, null, null, null, null, null, null),
                    null, null, null, null, null, null),
            },
        };

        var (summary, chapters) = ResourceReportMaterializer.Build(
            ResourceReportKind.ResourceTrend, from, to, samples, Array.Empty<ResourceSignalDto>());

        Assert.Contains("samples", summary, StringComparison.OrdinalIgnoreCase);
        Assert.NotEmpty(chapters);
        Assert.Equal("Overview", chapters[0].Title);
    }
}
