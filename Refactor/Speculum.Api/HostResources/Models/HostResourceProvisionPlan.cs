namespace Speculum.Api.HostResources.Models;

/// <summary>Computed provision plan (preview or pre-apply).</summary>
public sealed record HostResourceProvisionPlan(
    long HostMemoryTotalBytes,
    int HostCpuCount,
    string HostSource,
    long BudgetBytes,
    long ReserveBytes,
    long ShmTargetBytes,
    bool RaiseUlimits,
    long Nofile,
    long Nproc,
    HostResourceProvisionParams Params);
