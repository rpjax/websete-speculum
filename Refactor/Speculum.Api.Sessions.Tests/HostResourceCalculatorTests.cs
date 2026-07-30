using Speculum.Api.HostResources.Models;
using Speculum.Api.HostResources.Services;

namespace Speculum.Api.Sessions.Tests;

public sealed class HostResourceCalculatorTests
{
    private const long GiB = 1024L * 1024 * 1024;

    [Fact]
    public void Compute_WithMaxRamCeiling_UsesBudgetNotFullHost()
    {
        var parameters = new HostResourceProvisionParams
        {
            MaxRamBytes = 8 * GiB,
            ReservePercent = 15,
            ReserveMinBytes = 2 * GiB,
            ShmMinBytes = 2 * GiB,
            ShmMaxPercentOfBudget = 75,
        };

        var plan = HostResourceCalculator.Compute(
            parameters,
            hostMemoryTotalBytes: 32 * GiB,
            hostCpuCount: 16,
            hostSource: "machine");

        Assert.Equal(8 * GiB, plan.BudgetBytes);
        Assert.Equal(2 * GiB, plan.ReserveBytes);
        Assert.Equal(6 * GiB, plan.ShmTargetBytes);
    }

    [Fact]
    public void Compute_WithoutMaxRam_UsesHostTotalWithPercentCap()
    {
        var parameters = new HostResourceProvisionParams
        {
            MaxRamBytes = null,
            ReservePercent = 15,
            ReserveMinBytes = 2 * GiB,
            ShmMinBytes = 2 * GiB,
            ShmMaxPercentOfBudget = 75,
        };

        var plan = HostResourceCalculator.Compute(
            parameters,
            hostMemoryTotalBytes: 32 * GiB,
            hostCpuCount: 8,
            hostSource: "machine");

        // reserve = max(2GiB, 15% of 32) = 4.8 GiB
        var expectedReserve = (long)Math.Ceiling(32 * GiB * 0.15);
        Assert.Equal(expectedReserve, plan.ReserveBytes);
        var raw = 32 * GiB - expectedReserve;
        var cap = (long)Math.Floor(32 * GiB * 0.75);
        Assert.Equal(Math.Clamp(raw, 2 * GiB, cap), plan.ShmTargetBytes);
        Assert.Equal(cap, plan.ShmTargetBytes);
    }

    [Fact]
    public void ValidateAgainstHost_RejectsBudgetBelowShmMinAfterReserve()
    {
        var parameters = new HostResourceProvisionParams
        {
            MaxRamBytes = 3 * GiB,
            ReservePercent = 15,
            ReserveMinBytes = 2 * GiB,
            ShmMinBytes = 2 * GiB,
            ShmMaxPercentOfBudget = 75,
        };

        var error = HostResourceCalculator.ValidateAgainstHost(parameters, hostMemoryTotalBytes: 32 * GiB);
        Assert.NotNull(error);
        Assert.Contains("shmMinBytes", error, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void ValidateParams_RejectsInvalidPercents()
    {
        Assert.NotNull(HostResourceCalculator.ValidateParams(new HostResourceProvisionParams
        {
            ReservePercent = 95,
        }));
        Assert.NotNull(HostResourceCalculator.ValidateParams(new HostResourceProvisionParams
        {
            MaxRamBytes = 0,
        }));
    }
}
