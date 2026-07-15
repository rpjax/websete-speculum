using System.Diagnostics;
using Speculum.Api.Diagnostics.Telemetry;

namespace Speculum.Api.Diagnostics.Probes;

/// <summary>
/// Shared host-resource collector (used by both <c>/host</c> and the Telemetry sampler).
/// Stateful: CPU usage is a delta of <see cref="Process.TotalProcessorTime"/> between samples,
/// and results are cached for <c>minIntervalMs</c> so bursty callers don't thrash the OS.
/// </summary>
public sealed class HostResourceProbe
{
    private readonly object _gate = new();
    private DateTimeOffset _lastSampleUtc = DateTimeOffset.MinValue;
    private HostTelemetry? _lastSample;
    private TimeSpan _lastCpuTotal = TimeSpan.Zero;
    private DateTimeOffset _lastCpuUtc = DateTimeOffset.MinValue;

    public HostTelemetry Sample(int minIntervalMs)
    {
        lock (_gate)
        {
            var now = DateTimeOffset.UtcNow;
            if (_lastSample is not null
                && (now - _lastSampleUtc).TotalMilliseconds < minIntervalMs)
                return _lastSample;

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

            var gcInfo = GC.GetGCMemoryInfo();
            ThreadPool.GetAvailableThreads(out var availableWorker, out _);
            ThreadPool.GetMaxThreads(out var maxWorker, out _);

            _lastSample = new HostTelemetry(
                Hostname: Environment.MachineName,
                UptimeSec: SafeUptimeSec(proc, now),
                CpuUsage: Math.Round(cpuUsage, 2),
                MemoryUsed: proc.WorkingSet64,
                MemoryPrivate: proc.PrivateMemorySize64,
                MemoryTotal: gcInfo.TotalAvailableMemoryBytes,
                GcHeap: GC.GetTotalMemory(false),
                GcGen0: GC.CollectionCount(0),
                GcGen1: GC.CollectionCount(1),
                GcGen2: GC.CollectionCount(2),
                ThreadCount: proc.Threads.Count,
                ThreadPoolBusy: Math.Max(0, maxWorker - availableWorker),
                ThreadPoolQueued: (int)Math.Min(int.MaxValue, ThreadPool.PendingWorkItemCount),
                DiskFreeBytes: SafeDiskFree());
            _lastSampleUtc = now;
            return _lastSample;
        }
    }

    private static long SafeUptimeSec(Process proc, DateTimeOffset now)
    {
        try { return (long)(now - proc.StartTime.ToUniversalTime()).TotalSeconds; }
        catch { return 0; }
    }

    private static long SafeDiskFree()
    {
        try
        {
            var root = Path.GetPathRoot(AppContext.BaseDirectory);
            return string.IsNullOrEmpty(root) ? 0 : new DriveInfo(root).AvailableFreeSpace;
        }
        catch { return 0; }
    }
}
