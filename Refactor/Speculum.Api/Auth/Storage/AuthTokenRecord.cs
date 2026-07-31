using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Speculum.Api.Auth.Storage;

[Table("auth_tokens")]
public sealed class AuthTokenRecord
{
    [Key]
    [Column("id", TypeName = "TEXT")]
    public Guid Id { get; set; }

    [Column("user_id", TypeName = "TEXT")]
    public Guid UserId { get; set; }

    /// <summary>access | refresh</summary>
    [Required]
    [Column("kind")]
    public string Kind { get; set; } = "";

    [Required]
    [Column("token_hash")]
    public string TokenHash { get; set; } = "";

    [Column("expires_at")]
    public DateTimeOffset ExpiresAt { get; set; }

    [Column("revoked_at")]
    public DateTimeOffset? RevokedAt { get; set; }

    [Column("created_at")]
    public DateTimeOffset CreatedAt { get; set; }

    /// <summary>For refresh rotation: hash of the access token issued with this refresh.</summary>
    [Column("family_id", TypeName = "TEXT")]
    public Guid FamilyId { get; set; }
}
