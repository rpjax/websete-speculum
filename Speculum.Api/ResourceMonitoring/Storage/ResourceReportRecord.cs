using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Speculum.Api.ResourceMonitoring.Storage;

[Table("resource_reports")]
public sealed class ResourceReportRecord
{
    [Key]
    [Column("id")]
    public Guid Id { get; set; }

    [Required]
    [Column("kind")]
    public string Kind { get; set; } = "";

    [Required]
    [Column("status")]
    public string Status { get; set; } = "";

    [Column("from_utc")]
    public DateTimeOffset From { get; set; }

    [Column("to_utc")]
    public DateTimeOffset To { get; set; }

    [Column("created_at")]
    public DateTimeOffset CreatedAt { get; set; }

    [Column("ready_at")]
    public DateTimeOffset? ReadyAt { get; set; }

    [Required]
    [Column("summary")]
    public string Summary { get; set; } = "";

    [Required]
    [Column("chapters_json")]
    public string ChaptersJson { get; set; } = "[]";

    [Column("error_json")]
    public string? ErrorJson { get; set; }
}
