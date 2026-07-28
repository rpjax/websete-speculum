namespace Speculum.Api.Telemetry.Models;

public sealed record HostTelemetry(
    string Hostname, string Source, long UptimeSec, double CpuUsage, int CpuCount,
    long MemoryUsed, long MemoryAvailable, long MemoryTotal, long DiskFreeBytes, long DiskTotalBytes,
    double? LoadAverage1m, double? LoadAverage5m, double? LoadAverage15m,
    long? SwapUsed, long? SwapTotal, double? DiskReadBytesPerSec, double? DiskWriteBytesPerSec,
    double? NetworkRxBytesPerSec, double? NetworkTxBytesPerSec);

public sealed record ApiProcessTelemetry(
    long UptimeSec, double CpuUsage, long MemoryUsed, int ThreadCount,
    long? MemoryPrivate, long? GcHeap, int? GcGen0, int? GcGen1, int? GcGen2,
    int? ThreadPoolBusy, int? ThreadPoolQueued);

public sealed record SessionsTelemetry(
    int Total, int Live, int CapacityMax, double CapacityUsedPct,
    double? AvgFps, double? MinFps, double? MaxFps,
    IReadOnlyList<string>? LiveSessionIds, IReadOnlyList<SessionTelemetryItem>? Sessions);

public sealed record SessionTelemetryItem(
    Guid SessionId, Guid ProfileId, bool JsBridgeEnabled, bool ConnectionOpen,
    long UptimeMs, double? Fps, string? UrlHost);

public sealed record SidecarTelemetryRequest(
    bool IncludeProcess, bool IncludeEventLoop, bool IncludeChrome, bool IncludeQueues,
    bool IncludeSessionsSummary, bool IncludeFaultedIds);

public sealed record SidecarTelemetrySample(
    SidecarProcessTelemetry? Process,
    SidecarEventLoopTelemetry? EventLoop,
    SidecarChromeTelemetry? Chrome,
    SidecarQueueTelemetry? Queues,
    SidecarSessionsSummary? Sessions);

public sealed record SidecarProcessTelemetry(
    double CpuUsage, long MemoryRss, long MemoryHeapUsed, long MemoryHeapTotal, int Pid, double UptimeSec);
public sealed record SidecarEventLoopTelemetry(double DelayMsP50, double DelayMsP99, double Utilization);
public sealed record SidecarChromeTelemetry(int BrowserCount, int PageCount, long? TotalJsHeapUsed);
public sealed record SidecarQueueTelemetry(
    int VideoDepth, int AudioDepth, int ConsoleDepth, int? InputDepth, long? DroppedTotal);
public sealed record SidecarSessionsSummary(
    int Registered, int Open, int Faulted, IReadOnlyList<string>? FaultedSessionIds);

public sealed record ProfilesTelemetry(int Total, long? StorageBytes);

public sealed record JournalTelemetry(
    int QueueDepth, long DroppedTotal, bool Degraded,
    long? PersistFailures, long? GuaranteedAdmissionFailures,
    bool? QueuePressureActive, bool? PersistDegraded, bool? DrainRunning, bool? AdmissionOpen);

public sealed record DockerTelemetry(
    DockerRuntimeTelemetry? Runtime, IReadOnlyList<DockerContainerTelemetry>? Containers);
public sealed record DockerRuntimeTelemetry(
    string? ServerVersion, string? OperatingSystem, string? Architecture,
    int Containers, int ContainersRunning, int ContainersStopped);
public sealed record DockerContainerTelemetry(
    string Id, string Name, string Image, string State,
    double? CpuUsage, long? MemoryUsage, long? MemoryLimit,
    long? NetworkRxBytes, long? NetworkTxBytes);
