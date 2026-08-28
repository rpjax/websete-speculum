namespace Speculum.Api.BrowserClients;

/// <summary>Sidecar result for admin host-resource apply.</summary>
public sealed record HostResourcesApplyOutcome(
    long ShmBeforeBytes,
    long ShmAppliedBytes,
    bool UlimitsRaised,
    long? NofileApplied,
    long? NprocApplied,
    IReadOnlyList<string> Warnings);

/// <summary>Sidecar snapshot of current shm / ulimits.</summary>
public sealed record HostResourcesLiveStatus(
    long ShmSizeBytes,
    long? Nofile,
    long? Nproc);
