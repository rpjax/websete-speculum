using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using Microsoft.EntityFrameworkCore;
using Speculum.Api.Configurations.Models.Sessions;
using Speculum.Api.Sessions.Models;

namespace Speculum.Api.Sessions.Storage;

[Table("browser_sessions")]
[Index(nameof(ProfileId), Name = "ix_browser_sessions_profile")]
[Index(nameof(State), Name = "ix_browser_sessions_state")]
[Index(nameof(CreatedAt), Name = "ix_browser_sessions_created_at")]
public sealed class SessionRecord
{
    [Key]
    [Column("id", TypeName = "TEXT")]
    public Guid Id { get; set; }

    [Column("profile_id", TypeName = "TEXT")]
    public Guid ProfileId { get; set; }

    [Column("state")]
    public LifecycleState State { get; set; }

    /// <summary>UTC Start time. Columns below were added post-first-boot — see
    /// <see cref="Database.DatabaseServiceCollectionExtensions"/> EnsureSessionRecordColumns.</summary>
    [Column("created_at", TypeName = "TEXT")]
    public DateTimeOffset CreatedAt { get; set; }

    [Column("stopped_at", TypeName = "TEXT")]
    public DateTimeOffset? StoppedAt { get; set; }

    [Column("aborted_at", TypeName = "TEXT")]
    public DateTimeOffset? AbortedAt { get; set; }

    [Column("stop_reason")]
    public StopReason? StopReason { get; set; }

    [Column("mirror_mode")]
    public MirrorMode? MirrorMode { get; set; }

    [Column("viewport_width")]
    public int? ViewportWidth { get; set; }

    [Column("viewport_height")]
    public int? ViewportHeight { get; set; }
}
