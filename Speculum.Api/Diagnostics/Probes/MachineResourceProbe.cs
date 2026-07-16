using Speculum.Api.Diagnostics.Configuration;
using Speculum.Api.Diagnostics.Telemetry;

namespace Speculum.Api.Diagnostics.Probes;

/// <summary>
/// Machine/VPS resource collector (shared by telemetry sampler and <c>/host</c> probe).
/// Reads configurable procfs (<see cref="TelemetryHostOptions.ProcPath"/>). On Windows or
/// missing procfs returns <c>source: unavailable</c> without inventing process metrics.
/// </summary>
public sealed class MachineResourceProbe
{
    private readonly object _gate = new();
    private DateTimeOffset _lastSampleUtc = DateTimeOffset.MinValue;
    private HostTelemetry? _lastSample;

    private ulong _lastCpuTotal;
    private ulong _lastCpuIdle;
    private DateTimeOffset _lastCpuUtc = DateTimeOffset.MinValue;

    private ulong _lastDiskRead;
    private ulong _lastDiskWrite;
    private DateTimeOffset _lastDiskUtc = DateTimeOffset.MinValue;

    private ulong _lastNetRx;
    private ulong _lastNetTx;
    private DateTimeOffset _lastNetUtc = DateTimeOffset.MinValue;

    public HostTelemetry Sample(TelemetryHostOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        var minIntervalMs = Math.Clamp(options.SampleIntervalMs, 100, 60_000);

        lock (_gate)
        {
            var now = DateTimeOffset.UtcNow;
            if (_lastSample is not null
                && (now - _lastSampleUtc).TotalMilliseconds < minIntervalMs)
                return ApplyIncludes(_lastSample, options);

            var full = CollectFresh(options, now);
            _lastSample = full;
            _lastSampleUtc = now;
            return ApplyIncludes(full, options);
        }
    }

    private HostTelemetry CollectFresh(TelemetryHostOptions options, DateTimeOffset now)
    {
        var procPath = string.IsNullOrWhiteSpace(options.ProcPath) ? "/proc" : options.ProcPath.TrimEnd('/');
        var hostname = Environment.MachineName;

        if (!OperatingSystem.IsLinux() || !Directory.Exists(procPath))
        {
            return Unavailable(hostname, options);
        }

        var (memTotal, memAvailable, swapTotal, swapFree) = ReadMemInfo(procPath);
        var memoryUsed = Math.Max(0, memTotal - memAvailable);
        var (diskFree, diskTotal) = ReadDisk(options.DiskPath);
        var uptimeSec = ReadUptime(procPath);
        var cpuCount = ReadCpuCount(procPath);
        var (cpuUsage, sourceHint) = ReadCpuUsage(procPath, now, cpuCount);
        var (load1, load5, load15) = ReadLoadAvg(procPath);
        var (swapUsed, swapTot) = (Math.Max(0L, (long)(swapTotal - swapFree)), (long)swapTotal);
        var (diskReadBps, diskWriteBps) = ReadDiskIo(procPath, options.DiskPath, now);
        var (netRxBps, netTxBps) = ReadNetwork(procPath, now);

        // Host-mounted proc (e.g. /host/proc) is machine; bare /proc in a container is cgroup-scoped.
        var source = sourceHint == "unavailable"
            ? "unavailable"
            : LooksLikeHostMount(procPath) ? "machine" : "cgroup";

        return new HostTelemetry(
            Hostname: hostname,
            Source: source,
            UptimeSec: uptimeSec,
            CpuUsage: Math.Round(cpuUsage, 2),
            CpuCount: cpuCount,
            MemoryUsed: (long)memoryUsed,
            MemoryAvailable: (long)memAvailable,
            MemoryTotal: (long)memTotal,
            DiskFreeBytes: diskFree,
            DiskTotalBytes: diskTotal,
            LoadAverage1m: load1,
            LoadAverage5m: load5,
            LoadAverage15m: load15,
            SwapUsed: swapUsed,
            SwapTotal: swapTot,
            DiskReadBytesPerSec: diskReadBps,
            DiskWriteBytesPerSec: diskWriteBps,
            NetworkRxBytesPerSec: netRxBps,
            NetworkTxBytesPerSec: netTxBps);
    }

    private static bool LooksLikeHostMount(string procPath)
        => !string.Equals(procPath, "/proc", StringComparison.OrdinalIgnoreCase);

    private static HostTelemetry Unavailable(string hostname, TelemetryHostOptions options)
    {
        var (diskFree, diskTotal) = ReadDisk(options.DiskPath);
        return new HostTelemetry(
            Hostname: hostname,
            Source: "unavailable",
            UptimeSec: 0,
            CpuUsage: 0,
            CpuCount: Math.Max(1, Environment.ProcessorCount),
            MemoryUsed: 0,
            MemoryAvailable: 0,
            MemoryTotal: 0,
            DiskFreeBytes: diskFree,
            DiskTotalBytes: diskTotal,
            LoadAverage1m: null,
            LoadAverage5m: null,
            LoadAverage15m: null,
            SwapUsed: null,
            SwapTotal: null,
            DiskReadBytesPerSec: null,
            DiskWriteBytesPerSec: null,
            NetworkRxBytesPerSec: null,
            NetworkTxBytesPerSec: null);
    }

    private static HostTelemetry ApplyIncludes(HostTelemetry full, TelemetryHostOptions options)
        => full with
        {
            LoadAverage1m = options.IncludeLoadAverage ? full.LoadAverage1m : null,
            LoadAverage5m = options.IncludeLoadAverage ? full.LoadAverage5m : null,
            LoadAverage15m = options.IncludeLoadAverage ? full.LoadAverage15m : null,
            SwapUsed = options.IncludeSwap ? full.SwapUsed : null,
            SwapTotal = options.IncludeSwap ? full.SwapTotal : null,
            DiskReadBytesPerSec = options.IncludeDiskIo ? full.DiskReadBytesPerSec : null,
            DiskWriteBytesPerSec = options.IncludeDiskIo ? full.DiskWriteBytesPerSec : null,
            NetworkRxBytesPerSec = options.IncludeNetwork ? full.NetworkRxBytesPerSec : null,
            NetworkTxBytesPerSec = options.IncludeNetwork ? full.NetworkTxBytesPerSec : null,
        };

    private (double cpuUsage, string sourceHint) ReadCpuUsage(string procPath, DateTimeOffset now, int cpuCount)
    {
        try
        {
            var line = File.ReadLines(Path.Combine(procPath, "stat")).FirstOrDefault();
            if (line is null || !line.StartsWith("cpu ", StringComparison.Ordinal))
                return (0, "unavailable");

            var parts = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            // cpu user nice system idle iowait irq softirq steal ...
            if (parts.Length < 5
                || !ulong.TryParse(parts[1], out var user)
                || !ulong.TryParse(parts[2], out var nice)
                || !ulong.TryParse(parts[3], out var system)
                || !ulong.TryParse(parts[4], out var idle))
                return (0, "unavailable");

            ulong iowait = parts.Length > 5 && ulong.TryParse(parts[5], out var iw) ? iw : 0;
            ulong irq = parts.Length > 6 && ulong.TryParse(parts[6], out var ir) ? ir : 0;
            ulong softirq = parts.Length > 7 && ulong.TryParse(parts[7], out var si) ? si : 0;
            ulong steal = parts.Length > 8 && ulong.TryParse(parts[8], out var st) ? st : 0;

            var total = user + nice + system + idle + iowait + irq + softirq + steal;
            var idleAll = idle + iowait;

            double usage = 0;
            if (_lastCpuUtc != DateTimeOffset.MinValue && total > _lastCpuTotal)
            {
                var totalDelta = total - _lastCpuTotal;
                var idleDelta = idleAll >= _lastCpuIdle ? idleAll - _lastCpuIdle : 0;
                if (totalDelta > 0)
                    usage = Math.Clamp((1.0 - (double)idleDelta / totalDelta) * 100.0, 0, 100);
            }

            _lastCpuTotal = total;
            _lastCpuIdle = idleAll;
            _lastCpuUtc = now;
            _ = cpuCount;
            return (usage, "ok");
        }
        catch
        {
            return (0, "unavailable");
        }
    }

    private static (ulong memTotal, ulong memAvailable, ulong swapTotal, ulong swapFree) ReadMemInfo(string procPath)
    {
        ulong memTotal = 0, memAvailable = 0, swapTotal = 0, swapFree = 0;
        try
        {
            foreach (var line in File.ReadLines(Path.Combine(procPath, "meminfo")))
            {
                if (TryMemKb(line, "MemTotal:", out var mt)) memTotal = mt * 1024;
                else if (TryMemKb(line, "MemAvailable:", out var ma)) memAvailable = ma * 1024;
                else if (TryMemKb(line, "SwapTotal:", out var st)) swapTotal = st * 1024;
                else if (TryMemKb(line, "SwapFree:", out var sf)) swapFree = sf * 1024;
            }
            if (memAvailable == 0 && memTotal > 0)
            {
                // Older kernels: approximate Available ≈ MemFree + Buffers + Cached (not exact).
                ulong memFree = 0, buffers = 0, cached = 0;
                foreach (var line in File.ReadLines(Path.Combine(procPath, "meminfo")))
                {
                    if (TryMemKb(line, "MemFree:", out var mf)) memFree = mf * 1024;
                    else if (TryMemKb(line, "Buffers:", out var b)) buffers = b * 1024;
                    else if (TryMemKb(line, "Cached:", out var c)) cached = c * 1024;
                }
                memAvailable = memFree + buffers + cached;
            }
        }
        catch { /* zeros */ }
        return (memTotal, memAvailable, swapTotal, swapFree);
    }

    private static bool TryMemKb(string line, string key, out ulong kb)
    {
        kb = 0;
        if (!line.StartsWith(key, StringComparison.Ordinal)) return false;
        var parts = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        return parts.Length >= 2 && ulong.TryParse(parts[1], out kb);
    }

    private static long ReadUptime(string procPath)
    {
        try
        {
            var text = File.ReadAllText(Path.Combine(procPath, "uptime"));
            var first = text.Split(' ', StringSplitOptions.RemoveEmptyEntries)[0];
            return double.TryParse(first, System.Globalization.NumberStyles.Float,
                System.Globalization.CultureInfo.InvariantCulture, out var sec)
                ? (long)sec
                : 0;
        }
        catch { return 0; }
    }

    private static int ReadCpuCount(string procPath)
    {
        try
        {
            var count = File.ReadLines(Path.Combine(procPath, "cpuinfo"))
                .Count(l => l.StartsWith("processor", StringComparison.OrdinalIgnoreCase));
            return count > 0 ? count : Math.Max(1, Environment.ProcessorCount);
        }
        catch
        {
            return Math.Max(1, Environment.ProcessorCount);
        }
    }

    private static (double? load1, double? load5, double? load15) ReadLoadAvg(string procPath)
    {
        try
        {
            var parts = File.ReadAllText(Path.Combine(procPath, "loadavg"))
                .Split(' ', StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length < 3) return (null, null, null);
            var inv = System.Globalization.CultureInfo.InvariantCulture;
            double? Parse(string s) => double.TryParse(s, System.Globalization.NumberStyles.Float, inv, out var v) ? v : null;
            return (Parse(parts[0]), Parse(parts[1]), Parse(parts[2]));
        }
        catch { return (null, null, null); }
    }

    private static (long free, long total) ReadDisk(string? diskPath)
    {
        try
        {
            var root = !string.IsNullOrWhiteSpace(diskPath)
                ? diskPath
                : Path.GetPathRoot(AppContext.BaseDirectory);
            if (string.IsNullOrEmpty(root)) return (0, 0);
            var info = new DriveInfo(root);
            return (info.AvailableFreeSpace, info.TotalSize);
        }
        catch { return (0, 0); }
    }

    private (double? readBps, double? writeBps) ReadDiskIo(string procPath, string? diskPath, DateTimeOffset now)
    {
        try
        {
            // Sum all non-ram/loop devices; coarse but stable without mapping diskPath → major:minor.
            ulong readSectors = 0, writeSectors = 0;
            foreach (var line in File.ReadLines(Path.Combine(procPath, "diskstats")))
            {
                var p = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
                if (p.Length < 14) continue;
                var name = p[2];
                if (name.StartsWith("loop", StringComparison.Ordinal) || name.StartsWith("ram", StringComparison.Ordinal))
                    continue;
                // Prefer whole disks (sdX, nvmeXnY, vdX) over partitions (has trailing digit without 'p' nuance).
                if (char.IsDigit(name[^1]) && !name.Contains('p', StringComparison.Ordinal))
                    continue;
                if (ulong.TryParse(p[5], out var r)) readSectors += r;
                if (ulong.TryParse(p[9], out var w)) writeSectors += w;
            }

            const int sector = 512;
            double? readBps = null, writeBps = null;
            if (_lastDiskUtc != DateTimeOffset.MinValue)
            {
                var dt = (now - _lastDiskUtc).TotalSeconds;
                if (dt > 0)
                {
                    readBps = readSectors >= _lastDiskRead
                        ? (readSectors - _lastDiskRead) * sector / dt
                        : 0;
                    writeBps = writeSectors >= _lastDiskWrite
                        ? (writeSectors - _lastDiskWrite) * sector / dt
                        : 0;
                }
            }
            _lastDiskRead = readSectors;
            _lastDiskWrite = writeSectors;
            _lastDiskUtc = now;
            _ = diskPath;
            return (readBps ?? 0, writeBps ?? 0);
        }
        catch
        {
            return (0, 0);
        }
    }

    private (double? rxBps, double? txBps) ReadNetwork(string procPath, DateTimeOffset now)
    {
        try
        {
            ulong rx = 0, tx = 0;
            foreach (var line in File.ReadLines(Path.Combine(procPath, "net", "dev")).Skip(2))
            {
                var idx = line.IndexOf(':');
                if (idx <= 0) continue;
                var iface = line[..idx].Trim();
                if (iface is "lo" or "lo0") continue;
                var rest = line[(idx + 1)..].Split(' ', StringSplitOptions.RemoveEmptyEntries);
                if (rest.Length < 9) continue;
                if (ulong.TryParse(rest[0], out var r)) rx += r;
                if (ulong.TryParse(rest[8], out var t)) tx += t;
            }

            double? rxBps = null, txBps = null;
            if (_lastNetUtc != DateTimeOffset.MinValue)
            {
                var dt = (now - _lastNetUtc).TotalSeconds;
                if (dt > 0)
                {
                    rxBps = rx >= _lastNetRx ? (rx - _lastNetRx) / dt : 0;
                    txBps = tx >= _lastNetTx ? (tx - _lastNetTx) / dt : 0;
                }
            }
            _lastNetRx = rx;
            _lastNetTx = tx;
            _lastNetUtc = now;
            return (rxBps ?? 0, txBps ?? 0);
        }
        catch
        {
            return (0, 0);
        }
    }
}
