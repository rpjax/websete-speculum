using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using Microsoft.EntityFrameworkCore;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Journal.Storage;

[Table("journal_entries")]
[Index(nameof(Id), IsUnique = true)]
[Index(nameof(Type), nameof(SchemaVersion), Name = "ix_journal_entries_type")]
[Index(nameof(Type), nameof(PublishedAt), Name = "ix_journal_entries_type_published")]
[Index(nameof(PublishedAt), Name = "ix_journal_entries_published_at")]
public sealed class JournalEntryRecord
{
    [Key]
    [Column("sequence")]
    [DatabaseGenerated(DatabaseGeneratedOption.Identity)]
    public long Sequence { get; set; }

    [Column("id", TypeName = "TEXT")]
    public Guid Id { get; set; }

    [Required]
    [Column("type")]
    [MaxLength(256)]
    public string Type { get; set; } = "";

    [Column("published_at")]
    public DateTimeOffset PublishedAt { get; set; }

    [Column("schema_version")]
    public int SchemaVersion { get; set; }

    [Column("publish_policy")]
    public PublishPolicy PublishPolicy { get; set; }

    [Column("payload")]
    public string? Payload { get; set; }

    public List<JournalIndexKeyRecord> IndexKeys { get; set; } = new();
}
