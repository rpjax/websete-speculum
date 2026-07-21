using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Speculum.Api.BrowserProfiles.Storage;

[Table("browser_profiles")]
public sealed class ProfileRecord
{
    [Key]
    [Column("id", TypeName = "TEXT")]
    public Guid Id { get; set; }

    [Required]
    [Column("state_json")]
    public string StateJson { get; set; } = "{}";
}
