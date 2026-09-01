using Speculum.Api.Journal.Models;
using Speculum.Api.Journal.Storage;

namespace Speculum.Api.Journal.Storage;

internal static class JournalEntryMapper
{
    public static JournalEntryRecord ToRecord(JournalEntry entry)
    {
        ArgumentNullException.ThrowIfNull(entry);

        return new JournalEntryRecord
        {
            Id = entry.Id,
            Type = entry.Type,
            PublishedAt = entry.PublishedAt,
            SchemaVersion = entry.SchemaVersion,
            PublishPolicy = entry.PublishPolicy,
            Payload = entry.Payload,
            IndexKeys = entry.IndexKeys
                .Select(k => new JournalIndexKeyRecord
                {
                    Type = k.Type,
                    Value = k.Value,
                })
                .ToList(),
        };
    }

    public static JournalEntry ToEntry(JournalEntryRecord record)
    {
        ArgumentNullException.ThrowIfNull(record);

        return new JournalEntry
        {
            Id = record.Id,
            Sequence = record.Sequence,
            Type = record.Type,
            SchemaVersion = record.SchemaVersion,
            PublishPolicy = record.PublishPolicy,
            PublishedAt = record.PublishedAt,
            Payload = record.Payload,
            IndexKeys = record.IndexKeys
                .Select(k => new JournalIndexKey(k.Type, k.Value))
                .ToArray(),
        };
    }
}
