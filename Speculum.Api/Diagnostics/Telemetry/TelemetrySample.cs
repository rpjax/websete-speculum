namespace Speculum.Api.Diagnostics.Telemetry;

/// <summary>
/// Composite periodic snapshot of the motor's health, published as the
/// <c>Telemetry.SampleCollected</c> event payload. Every section is optional and only
/// present when its toggle is enabled — a section-shaped null means "not collected".
/// Overlaying host × motor × sidecar × persistence × pipeline on one time axis is how
/// the sample "tells a story" (symptom → signal); see docs/diagnostics.md.
/// </summary>
public sealed record TelemetrySample(
    HostTelemetry? Host,
    MotorTelemetry? Motor,
    SidecarTelemetry? Sidecar,
    PersistenceTelemetry? Persistence,
    PipelineTelemetry? Pipeline);

/// <summary>.NET process + machine resources for the API host.</summary>
public sealed record HostTelemetry(
    string Hostname,
    long UptimeSec,
    double CpuUsage,
    long MemoryUsed,
    long MemoryPrivate,
    long MemoryTotal,
    long GcHeap,
    int GcGen0,
    int GcGen1,
    int GcGen2,
    int ThreadCount,
    int ThreadPoolBusy,
    int ThreadPoolQueued,
    long DiskFreeBytes);

/// <summary>Aggregate live-motor state; opt-in identity via <c>LiveSessionIds</c>/<c>Sessions</c>.</summary>
public sealed record MotorTelemetry(
    int Total,
    int Live,
    int Starting,
    int Stopping,
    IReadOnlyDictionary<string, int> ByPhase,
    double AvgFps,
    double MinFps,
    double MaxFps,
    int InputQueueTotal,
    int FrameChannelDepthTotal,
    int StatusChannelDepthTotal,
    int CapacityMax,
    double CapacityUsedPct,
    IReadOnlyList<string>? LiveSessionIds,
    IReadOnlyList<MotorSessionTelemetry>? Sessions);

/// <summary>Per-session projection (opt-in). <c>UrlHost</c> only when IncludeUrlHost is set.</summary>
public sealed record MotorSessionTelemetry(
    string ConnectionId,
    string Phase,
    double Fps,
    long UptimeMs,
    int InputQueue,
    bool SidecarConnected,
    bool JsBridgeEnabled,
    string? LastFault,
    string? UrlHost);

/// <summary>Sidecar connectivity aggregate; opt-in faulted identity via <c>FaultedSessionIds</c>.</summary>
public sealed record SidecarTelemetry(
    int Connected,
    int Faulted,
    IReadOnlyList<string>? FaultedSessionIds);

/// <summary>Persisted browser-state store footprint; <c>StoreBytes</c> opt-in.</summary>
public sealed record PersistenceTelemetry(
    int StoredSessions,
    int TotalCookies,
    int TotalHistory,
    int ExpiringSoon,
    long? StoreBytes);

/// <summary>Diagnostics pipeline back-pressure; breaker window fields opt-in.</summary>
public sealed record PipelineTelemetry(
    long BytesUsed,
    long StorageMaxBytes,
    double UsedPct,
    long EventsStored,
    long EventsDropped,
    long OverflowCount,
    int ProbeInFlight,
    bool Degraded,
    bool ElevateActive,
    long? RecentDrops,
    long? RecentSlowWrites);
