namespace Speculum.Api.HostResources.Models;

public sealed record HostResourceHostSnapshot(
    long MemoryTotalBytes,
    long MemoryAvailableBytes,
    int CpuCount,
    string Source,
    long DiskTotalBytes,
    long DiskFreeBytes);

public sealed record HostResourceSidecarSnapshot(
    long? ShmSizeBytes,
    long? Nofile,
    long? Nproc,
    string? Error);

public sealed record HostResourceLastApplySnapshot(
    HostResourceProvisionParams Params,
    long BudgetBytes,
    long ReserveBytes,
    long ShmTargetBytes,
    long ShmAppliedBytes,
    long HostMemoryTotalBytes,
    int HostCpuCount,
    string HostSource,
    bool UlimitsRaised,
    IReadOnlyList<string> Warnings,
    DateTimeOffset AppliedAtUtc);

public sealed record HostResourceStatus(
    HostResourceHostSnapshot? Host,
    HostResourceSidecarSnapshot? Sidecar,
    HostResourceLastApplySnapshot? LastApply,
    string? HostError);
