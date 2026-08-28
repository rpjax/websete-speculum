using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using Microsoft.EntityFrameworkCore;

namespace Speculum.Api.Journal.Storage;

[Table("journal_index_keys")]
[PrimaryKey(nameof(JournalEntrySequence), nameof(Type))]
[Index(nameof(Type), nameof(Value), Name = "ix_journal_index_keys_lookup")]
public sealed class JournalIndexKeyRecord
{
    [Column("journal_entry_sequence")]
    public long JournalEntrySequence { get; set; }

    [Required]
    [Column("type")]
    [MaxLength(128)]
    public string Type { get; set; } = "";

    [Required]
    [Column("value")]
    [MaxLength(512)]
    public string Value { get; set; } = "";
}
