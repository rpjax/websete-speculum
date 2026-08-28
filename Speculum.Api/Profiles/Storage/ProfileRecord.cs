using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Speculum.Api.Profiles.Storage;

[Table("browser_profiles")]
public sealed class ProfileRecord
{
    [Key]
    [Column("id", TypeName = "TEXT")]
    public Guid Id { get; set; }

    [Required]
    [Column("state_json")]
    public string StateJson { get; set; } = "{}";

    [Column("created_at")]
    public DateTimeOffset CreatedAt { get; set; }

    /// <summary>Retention clock — last real use (start/stop/export). Column kept as updated_at.</summary>
    [Column("updated_at")]
    public DateTimeOffset LastUsedAt { get; set; }
}
