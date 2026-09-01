using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Speculum.Api.ResourceMonitoring.Storage;

[Table("resource_signals")]
public sealed class ResourceSignalRecord
{
    [Key]
    [Column("id")]
    public Guid Id { get; set; }

    [Required]
    [Column("kind")]
    public string Kind { get; set; } = "";

    [Required]
    [Column("severity")]
    public string Severity { get; set; } = "";

    [Required]
    [Column("status")]
    public string Status { get; set; } = "";

    [Required]
    [Column("phase")]
    public string Phase { get; set; } = "";

    [Required]
    [Column("summary")]
    public string Summary { get; set; } = "";

    [Column("detected_at")]
    public DateTimeOffset DetectedAt { get; set; }

    [Column("resolved_at")]
    public DateTimeOffset? ResolvedAt { get; set; }

    [Required]
    [Column("evidence_sample_ids_json")]
    public string EvidenceSampleIdsJson { get; set; } = "[]";

    [Required]
    [Column("metrics_json")]
    public string MetricsJson { get; set; } = "{}";

    [Column("chart_hint_json")]
    public string? ChartHintJson { get; set; }
}
