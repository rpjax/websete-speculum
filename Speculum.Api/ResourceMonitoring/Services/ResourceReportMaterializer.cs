using Speculum.Api.ResourceMonitoring.Models;
using Speculum.Api.ResourceMonitoring.Services.Contracts;
using Speculum.Api.Telemetry.Events.Models.Sampling;

namespace Speculum.Api.ResourceMonitoring.Services;

public static class ResourceReportMaterializer
{
    public static (string Summary, IReadOnlyList<ResourceReportChapterDto> Chapters) Build(
        ResourceReportKind kind,
        DateTimeOffset from,
        DateTimeOffset to,
        IReadOnlyList<ResourceHistoryItem> samples,
        IReadOnlyList<ResourceSignalDto> signals)
    {
        return kind switch
        {
            ResourceReportKind.ResourceTrend => BuildTrend(from, to, samples),
            ResourceReportKind.LeakSuspect => BuildLeak(from, to, samples, signals),
            ResourceReportKind.SaturationWindow => BuildSaturation(from, to, samples, signals),
            ResourceReportKind.JournalHealth => BuildJournal(from, to, samples, signals),
            _ => ("Unsupported report kind.", Array.Empty<ResourceReportChapterDto>()),
        };
    }

    private static (string, IReadOnlyList<ResourceReportChapterDto>) BuildTrend(
        DateTimeOffset from,
        DateTimeOffset to,
        IReadOnlyList<ResourceHistoryItem> samples)
    {
        var hostCpu = Stats(samples, s => s.Host?.CpuUsage);
        var hostMem = Stats(samples, s => s.Host is { } h && h.MemoryTotal > 0
            ? 100.0 * h.MemoryUsed / h.MemoryTotal
            : null);
        var apiMem = Stats(samples, s => s.ApiProcess?.MemoryUsed is long b ? b / (1024.0 * 1024.0) : null);
        var live = Stats(samples, s => s.Sessions?.Live);

        var summary =
            $"Resource trend from {from:u} to {to:u} across {samples.Count} samples.";
        var chapters = new List<ResourceReportChapterDto>
        {
            new()
            {
                Title = "Overview",
                Body = samples.Count == 0
                    ? "No Telemetry.Sampling.SampleCollected facts were found in this window."
                    : $"Collected {samples.Count} samples. Host CPU avg {Fmt(hostCpu.Avg)}%, memory avg {Fmt(hostMem.Avg)}%.",
                RelatedSampleIds = samples.Take(20).Select(s => s.Id).ToList(),
                SeriesSummary = new Dictionary<string, ResourceSeriesStatDto>
                {
                    ["host.cpu"] = hostCpu,
                    ["host.memoryPct"] = hostMem,
                    ["apiProcess.memory"] = apiMem,
                    ["sessions.live"] = live,
                },
            },
        };
        return (summary, chapters);
    }

    private static (string, IReadOnlyList<ResourceReportChapterDto>) BuildLeak(
        DateTimeOffset from,
        DateTimeOffset to,
        IReadOnlyList<ResourceHistoryItem> samples,
        IReadOnlyList<ResourceSignalDto> signals)
    {
        var leaks = signals.Where(s => s.Kind == ResourceSignalKind.ApiMemoryLeak).ToList();
        var summary = leaks.Count > 0
            ? $"Leak suspect window {from:u}–{to:u}: {leaks.Count} API memory leak signal(s)."
            : $"Leak suspect window {from:u}–{to:u}: no active apiMemoryLeak signals; trend narrative only.";

        var apiMem = Stats(samples, s => s.ApiProcess?.MemoryUsed is long b ? b / (1024.0 * 1024.0) : null);
        var chapters = new List<ResourceReportChapterDto>
        {
            new()
            {
                Title = "API memory",
                Body = $"API working set min/avg/max/last MB: {Fmt(apiMem.Min)} / {Fmt(apiMem.Avg)} / {Fmt(apiMem.Max)} / {Fmt(apiMem.Last)}.",
                RelatedSignalIds = leaks.Select(l => l.Id).ToList(),
                SeriesSummary = new Dictionary<string, ResourceSeriesStatDto> { ["apiProcess.memory"] = apiMem },
            },
        };
        return (summary, chapters);
    }

    private static (string, IReadOnlyList<ResourceReportChapterDto>) BuildSaturation(
        DateTimeOffset from,
        DateTimeOffset to,
        IReadOnlyList<ResourceHistoryItem> samples,
        IReadOnlyList<ResourceSignalDto> signals)
    {
        var sat = signals.Where(s =>
            s.Kind is ResourceSignalKind.HostSaturation or ResourceSignalKind.SessionCapacitySaturation)
            .ToList();
        var hostCpu = Stats(samples, s => s.Host?.CpuUsage);
        var capacity = Stats(samples, s => s.Sessions?.CapacityUsedPct);
        var summary =
            $"Saturation window {from:u}–{to:u}: {sat.Count} related signal(s).";
        var chapters = new List<ResourceReportChapterDto>
        {
            new()
            {
                Title = "Host and capacity",
                Body =
                    $"Host CPU avg {Fmt(hostCpu.Avg)}%. Session capacity avg {Fmt(capacity.Avg)}%.",
                RelatedSignalIds = sat.Select(s => s.Id).ToList(),
                SeriesSummary = new Dictionary<string, ResourceSeriesStatDto>
                {
                    ["host.cpu"] = hostCpu,
                    ["sessions.capacityPct"] = capacity,
                },
            },
        };
        return (summary, chapters);
    }

    private static (string, IReadOnlyList<ResourceReportChapterDto>) BuildJournal(
        DateTimeOffset from,
        DateTimeOffset to,
        IReadOnlyList<ResourceHistoryItem> samples,
        IReadOnlyList<ResourceSignalDto> signals)
    {
        var stress = signals.Where(s => s.Kind == ResourceSignalKind.JournalStress).ToList();
        var depth = Stats(samples, s => s.Journal?.QueueDepth);
        var dropped = Stats(samples, s => s.Journal?.DroppedTotal);
        var summary =
            $"Journal health {from:u}–{to:u}: {stress.Count} journalStress signal(s).";
        var chapters = new List<ResourceReportChapterDto>
        {
            new()
            {
                Title = "Admission and drops",
                Body =
                    $"Queue depth avg {Fmt(depth.Avg)}; dropped total last {Fmt(dropped.Last)}.",
                RelatedSignalIds = stress.Select(s => s.Id).ToList(),
                SeriesSummary = new Dictionary<string, ResourceSeriesStatDto>
                {
                    ["journal.queueDepth"] = depth,
                    ["journal.droppedTotal"] = dropped,
                },
            },
        };
        return (summary, chapters);
    }

    private static ResourceSeriesStatDto Stats(
        IReadOnlyList<ResourceHistoryItem> samples,
        Func<SampleCollected, double?> pick)
    {
        var values = samples.Select(s => pick(s.Sample)).Where(v => v.HasValue).Select(v => v!.Value).ToList();
        if (values.Count == 0)
            return new ResourceSeriesStatDto();

        return new ResourceSeriesStatDto
        {
            Min = values.Min(),
            Avg = values.Average(),
            Max = values.Max(),
            Last = values[^1],
        };
    }

    private static string Fmt(double? v)
        => v is null ? "—" : v.Value.ToString("0.##");
}
