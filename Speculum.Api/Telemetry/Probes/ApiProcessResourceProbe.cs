using System.Diagnostics;
using Speculum.Api.Configurations.Models.Telemetry;
using Speculum.Api.Telemetry.Models;

namespace Speculum.Api.Telemetry.Probes;

/// <summary>
/// Speculum.Api process + CLR collector (shared by telemetry sampler and <c>/api-process</c> probe).
/// Stateful: CPU is a delta of <see cref="Process.TotalProcessorTime"/>; results cached for
/// <see cref="ApiProcessTelemetryConfiguration.SampleIntervalMs"/>.
/// </summary>
public sealed class ApiProcessResourceProbe
{
    private readonly object _gate = new();
    private DateTimeOffset _lastSampleUtc = DateTimeOffset.MinValue;
    private ApiProcessTelemetry? _lastSample;
    private TimeSpan _lastCpuTotal = TimeSpan.Zero;
    private DateTimeOffset _lastCpuUtc = DateTimeOffset.MinValue;

    public ApiProcessTelemetry Sample(ApiProcessTelemetryConfiguration options)
    {
        ArgumentNullException.ThrowIfNull(options);
        var minIntervalMs = Math.Clamp(options.SampleIntervalMs, 100, 60_000);

        lock (_gate)
        {
            var now = DateTimeOffset.UtcNow;
            if (_lastSample is not null
                && (now - _lastSampleUtc).TotalMilliseconds < minIntervalMs)
                return ApplyIncludes(_lastSample, options);

            using var proc = Process.GetCurrentProcess();

            var cpuTotal = proc.TotalProcessorTime;
            double cpuUsage = 0;
            if (_lastCpuUtc != DateTimeOffset.MinValue)
            {
                var wallMs = (now - _lastCpuUtc).TotalMilliseconds;
                var cpuMs = (cpuTotal - _lastCpuTotal).TotalMilliseconds;
                if (wallMs > 0)
                    cpuUsage = Math.Clamp(
                        cpuMs / (wallMs * Math.Max(1, Environment.ProcessorCount)) * 100.0,
                        0, 100);
            }
            _lastCpuTotal = cpuTotal;
            _lastCpuUtc = now;

            ThreadPool.GetAvailableThreads(out var availableWorker, out _);
            ThreadPool.GetMaxThreads(out var maxWorker, out _);

            var full = new ApiProcessTelemetry(
                UptimeSec: SafeUptimeSec(proc, now),
                CpuUsage: Math.Round(cpuUsage, 2),
                MemoryUsed: proc.WorkingSet64,
                ThreadCount: proc.Threads.Count,
                MemoryPrivate: proc.PrivateMemorySize64,
                GcHeap: GC.GetTotalMemory(false),
                GcGen0: GC.CollectionCount(0),
                GcGen1: GC.CollectionCount(1),
                GcGen2: GC.CollectionCount(2),
                ThreadPoolBusy: Math.Max(0, maxWorker - availableWorker),
                ThreadPoolQueued: (int)Math.Min(int.MaxValue, ThreadPool.PendingWorkItemCount));

            _lastSample = full;
            _lastSampleUtc = now;
            return ApplyIncludes(full, options);
        }
    }

    private static ApiProcessTelemetry ApplyIncludes(
        ApiProcessTelemetry full,
        ApiProcessTelemetryConfiguration options)
        => full with
        {
            MemoryPrivate = options.IncludePrivateMemory ? full.MemoryPrivate : null,
            GcHeap = options.IncludeGarbageCollection ? full.GcHeap : null,
            GcGen0 = options.IncludeGarbageCollection ? full.GcGen0 : null,
            GcGen1 = options.IncludeGarbageCollection ? full.GcGen1 : null,
            GcGen2 = options.IncludeGarbageCollection ? full.GcGen2 : null,
            ThreadPoolBusy = options.IncludeThreadPool ? full.ThreadPoolBusy : null,
            ThreadPoolQueued = options.IncludeThreadPool ? full.ThreadPoolQueued : null,
        };

    private static long SafeUptimeSec(Process proc, DateTimeOffset now)
    {
        try { return (long)(now - proc.StartTime.ToUniversalTime()).TotalSeconds; }
        catch { return 0; }
    }
}
