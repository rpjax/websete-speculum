using System.Globalization;
using MessagePack;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Presentation.Journal;

/// <summary>
/// Wire projection of one admitted Journal fact for live observation.
/// </summary>
/// <remarks>
/// Carries catalog identity (<see cref="Type"/> + <see cref="SchemaVersion"/>) and the
/// envelope only; the fact body stays opaque JSON, so the stream never has to know a
/// domain or a fact shape.
/// </remarks>
[MessagePackObject]
public sealed class JournalFactHubEvent
{
    [Key("id")]
    public Guid Id { get; set; }

    /// <summary>Round-trip UTC admission stamp (string keeps JS off MessagePack date shapes).</summary>
    [Key("publishedAt")]
    public string PublishedAt { get; set; } = string.Empty;

    [Key("type")]
    public string Type { get; set; } = string.Empty;

    [Key("schemaVersion")]
    public int SchemaVersion { get; set; }

    [Key("publishPolicy")]
    public string PublishPolicy { get; set; } = string.Empty;

    /// <summary>Index keys as key type → value (at most one value per type).</summary>
    [Key("indexKeys")]
    public Dictionary<string, string> IndexKeys { get; set; } = new();

    [Key("payload")]
    public string? Payload { get; set; }
}

internal static class JournalFactHubEventMapper
{
    public static JournalFactHubEvent Map(JournalEntry entry)
    {
        ArgumentNullException.ThrowIfNull(entry);

        var indexKeys = new Dictionary<string, string>(entry.IndexKeys.Count, StringComparer.Ordinal);
        foreach (var key in entry.IndexKeys)
        {
            indexKeys[key.Type] = key.Value;
        }

        return new JournalFactHubEvent
        {
            Id = entry.Id,
            PublishedAt = entry.PublishedAt.ToUniversalTime()
                .ToString("O", CultureInfo.InvariantCulture),
            Type = entry.Type,
            SchemaVersion = entry.SchemaVersion,
            PublishPolicy = entry.PublishPolicy.ToString(),
            IndexKeys = indexKeys,
            Payload = entry.Payload,
        };
    }
}
