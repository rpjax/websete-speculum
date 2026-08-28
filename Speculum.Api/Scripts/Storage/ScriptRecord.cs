using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Speculum.Api.Scripts.Storage;

[Table("scripts")]
public sealed class ScriptRecord
{
    [Key]
    [Column("id", TypeName = "TEXT")]
    public Guid Id { get; set; }

    [Required]
    [Column("name")]
    public string Name { get; set; } = "";

    [Required]
    [Column("content")]
    public string Content { get; set; } = "";

    [Required]
    [Column("sha256")]
    public string Sha256 { get; set; } = "";

    [Column("size_bytes")]
    public int SizeBytes { get; set; }

    [Column("created_at")]
    public DateTimeOffset CreatedAtUtc { get; set; }

    [Column("updated_at")]
    public DateTimeOffset UpdatedAtUtc { get; set; }
}
