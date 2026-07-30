using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Speculum.Api.HostResources.Storage;

/// <summary>Singleton row (id=1) holding the last successful host-resource apply.</summary>
[Table("host_resource_applies")]
public sealed class HostResourceApplyRecord
{
    [Key]
    [Column("id")]
    public int Id { get; set; } = 1;

    [Column("max_ram_bytes")]
    public long? MaxRamBytes { get; set; }

    [Column("reserve_percent")]
    public double ReservePercent { get; set; }

    [Column("reserve_min_bytes")]
    public long ReserveMinBytes { get; set; }

    [Column("shm_min_bytes")]
    public long ShmMinBytes { get; set; }

    [Column("shm_max_percent_of_budget")]
    public double ShmMaxPercentOfBudget { get; set; }

    [Column("raise_ulimits")]
    public bool RaiseUlimits { get; set; }

    [Column("nofile")]
    public long Nofile { get; set; }

    [Column("nproc")]
    public long Nproc { get; set; }

    [Column("budget_bytes")]
    public long BudgetBytes { get; set; }

    [Column("reserve_bytes")]
    public long ReserveBytes { get; set; }

    [Column("shm_target_bytes")]
    public long ShmTargetBytes { get; set; }

    [Column("shm_applied_bytes")]
    public long ShmAppliedBytes { get; set; }

    [Column("host_memory_total_bytes")]
    public long HostMemoryTotalBytes { get; set; }

    [Column("host_cpu_count")]
    public int HostCpuCount { get; set; }

    [Required]
    [Column("host_source")]
    public string HostSource { get; set; } = "";

    [Column("ulimits_raised")]
    public bool UlimitsRaised { get; set; }

    [Required]
    [Column("warnings_json")]
    public string WarningsJson { get; set; } = "[]";

    [Column("applied_at")]
    public DateTimeOffset AppliedAtUtc { get; set; }
}
