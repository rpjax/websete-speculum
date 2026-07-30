using Speculum.Api.HostResources.Models;

namespace Speculum.Api.HostResources.Services;

/// <summary>
/// Pure host-resource sizing formula. Lives only in the API — sidecar executes computed bytes.
/// </summary>
public static class HostResourceCalculator
{
    public static string? ValidateParams(HostResourceProvisionParams parameters)
    {
        ArgumentNullException.ThrowIfNull(parameters);

        if (parameters.MaxRamBytes is { } maxRam && maxRam <= 0)
            return "maxRamBytes must be greater than 0 when set.";

        if (parameters.ReservePercent is < 0 or > 90)
            return "reservePercent must be between 0 and 90.";

        if (parameters.ShmMaxPercentOfBudget is <= 0 or > 100)
            return "shmMaxPercentOfBudget must be between 0 (exclusive) and 100.";

        if (parameters.ReserveMinBytes < 0)
            return "reserveMinBytes must be >= 0.";

        if (parameters.ShmMinBytes <= 0)
            return "shmMinBytes must be greater than 0.";

        if (parameters.RaiseUlimits)
        {
            if (parameters.Nofile < 1024)
                return "nofile must be >= 1024 when raiseUlimits is true.";
            if (parameters.Nproc < 256)
                return "nproc must be >= 256 when raiseUlimits is true.";
        }

        return null;
    }

    public static string? ValidateAgainstHost(
        HostResourceProvisionParams parameters,
        long hostMemoryTotalBytes)
    {
        var paramError = ValidateParams(parameters);
        if (paramError is not null)
            return paramError;

        if (hostMemoryTotalBytes <= 0)
            return "Host memory total is unavailable.";

        var plan = Compute(parameters, hostMemoryTotalBytes, hostCpuCount: 1, hostSource: "validate");
        var availableForShm = plan.BudgetBytes - plan.ReserveBytes;
        if (availableForShm < parameters.ShmMinBytes)
        {
            return
                $"Budget after reserve ({availableForShm} bytes) is below shmMinBytes ({parameters.ShmMinBytes}). Increase maxRamBytes or lower reserve.";
        }

        return null;
    }

    public static HostResourceProvisionPlan Compute(
        HostResourceProvisionParams parameters,
        long hostMemoryTotalBytes,
        int hostCpuCount,
        string hostSource)
    {
        ArgumentNullException.ThrowIfNull(parameters);
        ArgumentException.ThrowIfNullOrWhiteSpace(hostSource);

        var budget = parameters.MaxRamBytes is { } maxRam
            ? Math.Min(hostMemoryTotalBytes, maxRam)
            : hostMemoryTotalBytes;

        budget = Math.Max(0, budget);

        var reserveFromPercent = (long)Math.Ceiling(budget * (parameters.ReservePercent / 100.0));
        var reserve = Math.Max(parameters.ReserveMinBytes, reserveFromPercent);
        if (reserve > budget)
            reserve = budget;

        var raw = Math.Max(0, budget - reserve);
        var cap = (long)Math.Floor(budget * (parameters.ShmMaxPercentOfBudget / 100.0));
        var upper = Math.Max(parameters.ShmMinBytes, cap);
        var shmTarget = Math.Clamp(raw, parameters.ShmMinBytes, upper);

        return new HostResourceProvisionPlan(
            HostMemoryTotalBytes: hostMemoryTotalBytes,
            HostCpuCount: Math.Max(1, hostCpuCount),
            HostSource: hostSource.Trim(),
            BudgetBytes: budget,
            ReserveBytes: reserve,
            ShmTargetBytes: shmTarget,
            RaiseUlimits: parameters.RaiseUlimits,
            Nofile: parameters.Nofile,
            Nproc: parameters.Nproc,
            Params: parameters);
    }
}
