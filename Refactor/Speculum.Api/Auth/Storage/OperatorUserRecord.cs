using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Speculum.Api.Auth.Storage;

[Table("operator_users")]
public sealed class OperatorUserRecord
{
    [Key]
    [Column("id", TypeName = "TEXT")]
    public Guid Id { get; set; }

    [Required]
    [Column("username")]
    public string Username { get; set; } = "";

    [Required]
    [Column("password_hash")]
    public string PasswordHash { get; set; } = "";

    [Column("created_at")]
    public DateTimeOffset CreatedAt { get; set; }

    [Column("updated_at")]
    public DateTimeOffset UpdatedAt { get; set; }
}
