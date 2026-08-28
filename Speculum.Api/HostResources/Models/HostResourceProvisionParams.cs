namespace Speculum.Api.HostResources.Models;

/// <summary>
/// Admin-supplied knobs for host resource provision preview/apply.
/// </summary>
public sealed class HostResourceProvisionParams
{
    public const long DefaultReserveMinBytes = 2L * 1024 * 1024 * 1024;
    public const long DefaultShmMinBytes = 2L * 1024 * 1024 * 1024;
    public const double DefaultReservePercent = 15;
    public const double DefaultShmMaxPercentOfBudget = 75;
    public const long DefaultNofile = 1_048_576;
    public const long DefaultNproc = 65_535;

    /// <summary>
    /// Optional ceiling for the calculation base. When omitted, host <c>MemoryTotal</c> is used.
    /// </summary>
    public long? MaxRamBytes { get; init; }

    public double ReservePercent { get; init; } = DefaultReservePercent;

    public long ReserveMinBytes { get; init; } = DefaultReserveMinBytes;

    public long ShmMinBytes { get; init; } = DefaultShmMinBytes;

    public double ShmMaxPercentOfBudget { get; init; } = DefaultShmMaxPercentOfBudget;

    public bool RaiseUlimits { get; init; } = true;

    public long Nofile { get; init; } = DefaultNofile;

    public long Nproc { get; init; } = DefaultNproc;
}
