using Speculum.Api.ResourceMonitoring.Models;
using Speculum.Api.ResourceMonitoring.Services.Contracts;
using Speculum.Api.Telemetry.Events.Models.Sampling;

namespace Speculum.Api.ResourceMonitoring.Services;

/// <summary>
/// Pure detector rules over recent <see cref="SampleCollected"/> windows.
/// Thresholds are fixed product defaults (no operator tuning UI in V1).
/// </summary>
public static class ResourceSignalDetector
{
    public const double HostCpuCriticalPct = 95;
    public const double HostCpuWarningPct = 90;
    public const double HostMemCriticalPct = 95;
    public const double HostMemWarningPct = 90;
    public const int SustainedSamples = 3;
    public const double ApiMemRiseBytes = 64L * 1024 * 1024;
    public const double FpsDropRatio = 0.65;
    public const int ThreadPoolQueuedWarn = 32;
    public const int JournalQueueWarn = 100;

    public static IReadOnlyList<ResourceSignalDto> Evaluate(
        IReadOnlyList<(Guid Id, DateTimeOffset At, SampleCollected Sample)> window,
        DateTimeOffset now)
    {
        if (window.Count < SustainedSamples)
            return Array.Empty<ResourceSignalDto>();

        var results = new List<ResourceSignalDto>();
        TryHostSaturation(window, now, results);
        TryApiMemoryLeak(window, now, results);
        TryRenderRegression(window, now, results);
        TryThreadStarvation(window, now, results);
        TrySessionCapacity(window, now, results);
        TrySidecarInstability(window, now, results);
        TryJournalStress(window, now, results);
        return results;
    }

    private static void TryHostSaturation(
        IReadOnlyList<(Guid Id, DateTimeOffset At, SampleCollected Sample)> window,
        DateTimeOffset now,
        List<ResourceSignalDto> results)
    {
        var recent = window.TakeLast(SustainedSamples).ToList();
        var cpuHigh = recent.All(x => x.Sample.Host is { } h && h.CpuUsage >= HostCpuWarningPct);
        var memHigh = recent.All(x =>
        {
            if (x.Sample.Host is not { } h || h.MemoryTotal <= 0)
                return false;
            return (100.0 * h.MemoryUsed / h.MemoryTotal) >= HostMemWarningPct;
        });

        if (!cpuHigh && !memHigh)
            return;

        var last = recent[^1];
        var cpu = last.Sample.Host!.CpuUsage;
        var memPct = last.Sample.Host.MemoryTotal > 0
            ? 100.0 * last.Sample.Host.MemoryUsed / last.Sample.Host.MemoryTotal
            : 0;
        var critical = cpu >= HostCpuCriticalPct || memPct >= HostMemCriticalPct;

        results.Add(Make(
            ResourceSignalKind.HostSaturation,
            critical ? ResourceSignalSeverity.Critical : ResourceSignalSeverity.Warning,
            "host_threshold",
            $"Host saturation: CPU {cpu:0.#}%, memory {memPct:0.#}%.",
            recent.Select(r => r.Id).ToList(),
            now,
            recent[0].At,
            last.At,
            new Dictionary<string, double?>
            {
                ["host.cpu"] = cpu,
                ["host.memoryPct"] = memPct,
            },
            ["host.cpu", "host.memory"]));
    }

    private static void TryApiMemoryLeak(
        IReadOnlyList<(Guid Id, DateTimeOffset At, SampleCollected Sample)> window,
        DateTimeOffset now,
        List<ResourceSignalDto> results)
    {
        var withApi = window.Where(x => x.Sample.ApiProcess is not null).ToList();
        if (withApi.Count < SustainedSamples)
            return;

        var first = withApi[0].Sample.ApiProcess!.MemoryUsed;
        var last = withApi[^1].Sample.ApiProcess!.MemoryUsed;
        var rise = last - first;
        if (rise < ApiMemRiseBytes)
            return;

        var liveFirst = withApi[0].Sample.Sessions?.Live ?? 0;
        var liveLast = withApi[^1].Sample.Sessions?.Live ?? liveFirst;
        if (Math.Abs(liveLast - liveFirst) > 1)
            return; // sessions changed — not a flat-live leak signature

        var slice = withApi.TakeLast(Math.Min(withApi.Count, 12)).ToList();
        results.Add(Make(
            ResourceSignalKind.ApiMemoryLeak,
            rise >= ApiMemRiseBytes * 2 ? ResourceSignalSeverity.Critical : ResourceSignalSeverity.Warning,
            "api_memory_rise",
            $"API process memory rose {rise / (1024 * 1024):0} MB while live sessions stayed flat ({liveLast}).",
            slice.Select(s => s.Id).ToList(),
            now,
            slice[0].At,
            slice[^1].At,
            new Dictionary<string, double?>
            {
                ["apiProcess.memory"] = last / (1024.0 * 1024.0),
                ["sessions.live"] = liveLast,
            },
            ["apiProcess.memory", "sessions.live", "apiProcess.gcHeap"]));
    }

    private static void TryRenderRegression(
        IReadOnlyList<(Guid Id, DateTimeOffset At, SampleCollected Sample)> window,
        DateTimeOffset now,
        List<ResourceSignalDto> results)
    {
        var withFps = window.Where(x => x.Sample.Sessions?.AvgFps is not null).ToList();
        if (withFps.Count < SustainedSamples)
            return;

        var firstFps = withFps[0].Sample.Sessions!.AvgFps!.Value;
        var lastFps = withFps[^1].Sample.Sessions!.AvgFps!.Value;
        if (firstFps < 5 || lastFps >= firstFps * FpsDropRatio)
            return;

        var cpuFirst = withFps[0].Sample.Host?.CpuUsage ?? 0;
        var cpuLast = withFps[^1].Sample.Host?.CpuUsage ?? 0;
        if (cpuLast > cpuFirst + 15)
            return; // host CPU rose — not flat-host regression

        var slice = withFps.TakeLast(SustainedSamples).ToList();
        results.Add(Make(
            ResourceSignalKind.RenderRegression,
            ResourceSignalSeverity.Warning,
            "fps_drop",
            $"Average FPS fell from {firstFps:0.#} to {lastFps:0.#} while host CPU stayed relatively flat.",
            slice.Select(s => s.Id).ToList(),
            now,
            slice[0].At,
            slice[^1].At,
            new Dictionary<string, double?>
            {
                ["sessions.avgFps"] = lastFps,
                ["host.cpu"] = cpuLast,
            },
            ["sessions.avgFps", "host.cpu"]));
    }

    private static void TryThreadStarvation(
        IReadOnlyList<(Guid Id, DateTimeOffset At, SampleCollected Sample)> window,
        DateTimeOffset now,
        List<ResourceSignalDto> results)
    {
        var recent = window.TakeLast(SustainedSamples).ToList();
        if (!recent.All(x => (x.Sample.ApiProcess?.ThreadPoolQueued ?? 0) >= ThreadPoolQueuedWarn))
            return;

        var last = recent[^1];
        var queued = last.Sample.ApiProcess!.ThreadPoolQueued!.Value;
        results.Add(Make(
            ResourceSignalKind.ThreadStarvation,
            queued >= ThreadPoolQueuedWarn * 2 ? ResourceSignalSeverity.Critical : ResourceSignalSeverity.Warning,
            "thread_pool_queued",
            $"API thread pool queued work is elevated ({queued}).",
            recent.Select(r => r.Id).ToList(),
            now,
            recent[0].At,
            last.At,
            new Dictionary<string, double?>
            {
                ["apiProcess.threadPoolQueued"] = queued,
                ["apiProcess.threadPoolBusy"] = last.Sample.ApiProcess.ThreadPoolBusy,
            },
            ["apiProcess.threadPoolQueued", "apiProcess.threadPoolBusy"]));
    }

    private static void TrySessionCapacity(
        IReadOnlyList<(Guid Id, DateTimeOffset At, SampleCollected Sample)> window,
        DateTimeOffset now,
        List<ResourceSignalDto> results)
    {
        var last = window[^1];
        var pct = last.Sample.Sessions?.CapacityUsedPct;
        if (pct is null || pct < 100)
            return;

        results.Add(Make(
            ResourceSignalKind.SessionCapacitySaturation,
            ResourceSignalSeverity.Critical,
            "capacity_full",
            $"Session capacity is saturated ({pct:0.#}% of {last.Sample.Sessions!.CapacityMax}).",
            [last.Id],
            now,
            last.At.AddMinutes(-15),
            last.At,
            new Dictionary<string, double?>
            {
                ["sessions.capacityPct"] = pct,
                ["sessions.live"] = last.Sample.Sessions.Live,
            },
            ["sessions.capacityPct", "sessions.live"]));
    }

    private static void TrySidecarInstability(
        IReadOnlyList<(Guid Id, DateTimeOffset At, SampleCollected Sample)> window,
        DateTimeOffset now,
        List<ResourceSignalDto> results)
    {
        var withSide = window.Where(x => x.Sample.Sidecar?.Sessions is not null).ToList();
        if (withSide.Count < SustainedSamples)
            return;

        var firstFaulted = withSide[0].Sample.Sidecar!.Sessions!.Faulted;
        var lastFaulted = withSide[^1].Sample.Sidecar!.Sessions!.Faulted;
        if (lastFaulted <= firstFaulted)
            return;

        var slice = withSide.TakeLast(SustainedSamples).ToList();
        results.Add(Make(
            ResourceSignalKind.SidecarInstability,
            ResourceSignalSeverity.Warning,
            "sidecar_faulted_rise",
            $"Sidecar faulted session count rose from {firstFaulted} to {lastFaulted}.",
            slice.Select(s => s.Id).ToList(),
            now,
            slice[0].At,
            slice[^1].At,
            new Dictionary<string, double?>
            {
                ["sidecar.faulted"] = lastFaulted,
                ["sidecar.open"] = slice[^1].Sample.Sidecar!.Sessions!.Open,
            },
            ["sessions.live"]));
    }

    private static void TryJournalStress(
        IReadOnlyList<(Guid Id, DateTimeOffset At, SampleCollected Sample)> window,
        DateTimeOffset now,
        List<ResourceSignalDto> results)
    {
        var last = window[^1].Sample.Journal;
        if (last is null)
            return;

        var stressed = last.Degraded
            || last.QueueDepth >= JournalQueueWarn
            || last.DroppedTotal > 0
            || (last.PersistFailures ?? 0) > 0;
        if (!stressed)
            return;

        var recent = window.TakeLast(SustainedSamples).ToList();
        results.Add(Make(
            ResourceSignalKind.JournalStress,
            last.Degraded || (last.PersistFailures ?? 0) > 0
                ? ResourceSignalSeverity.Critical
                : ResourceSignalSeverity.Warning,
            "journal_pressure",
            $"Journal stress: queueDepth={last.QueueDepth}, dropped={last.DroppedTotal}, degraded={last.Degraded}.",
            recent.Select(r => r.Id).ToList(),
            now,
            recent[0].At,
            recent[^1].At,
            new Dictionary<string, double?>
            {
                ["journal.queueDepth"] = last.QueueDepth,
                ["journal.droppedTotal"] = last.DroppedTotal,
            },
            ["journal.queueDepth"]));
    }

    private static ResourceSignalDto Make(
        ResourceSignalKind kind,
        ResourceSignalSeverity severity,
        string phase,
        string summary,
        IReadOnlyList<Guid> evidence,
        DateTimeOffset now,
        DateTimeOffset from,
        DateTimeOffset to,
        IReadOnlyDictionary<string, double?> metrics,
        IReadOnlyList<string> metricKeys)
        => new()
        {
            Id = Guid.NewGuid(),
            Kind = kind,
            Severity = severity,
            Status = ResourceSignalStatus.Active,
            Phase = phase,
            Summary = summary,
            DetectedAt = now,
            EvidenceSampleIds = evidence,
            Metrics = metrics,
            ChartHint = new ResourceChartHint
            {
                From = from,
                To = to,
                MetricKeys = metricKeys,
            },
        };
}
