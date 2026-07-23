using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using Microsoft.EntityFrameworkCore;
using Speculum.Api.Sessions.Models;

namespace Speculum.Api.Sessions.Storage;

[Table("browser_sessions")]
[Index(nameof(ProfileId), Name = "ix_browser_sessions_profile")]
public sealed class SessionRecord
{
    [Key]
    [Column("id", TypeName = "TEXT")]
    public Guid Id { get; set; }

    [Column("profile_id", TypeName = "TEXT")]
    public Guid ProfileId { get; set; }

    [Column("state")]
    public LifecycleState State { get; set; }
}
