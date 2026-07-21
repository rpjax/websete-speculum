using System.Text.Json.Serialization.Metadata;
using Speculum.Api.Journal.Models;

namespace Speculum.Api.Journal.Catalog;

/// <summary>
/// In-memory registration of one Journal fact schema (not an API DTO, not persisted).
/// </summary>
public sealed class JournalEntryDescriptor
{
    public required string Type { get; init; }
    public required int SchemaVersion { get; init; }
    public string? Name { get; init; }
    public string? Description { get; init; }
    public string? Owner { get; init; }
    public PublishPolicy PublishPolicy { get; init; } = PublishPolicy.BestEffort;
    public bool EnabledByDefault { get; init; } = true;

    /// <summary>CLR payload type this descriptor was built from.</summary>
    public required Type ClrType { get; init; }

    /// <summary>Cached JSON metadata for <see cref="ClrType"/> (built once at register).</summary>
    public required JsonTypeInfo PayloadJsonTypeInfo { get; init; }

    public IReadOnlyList<string> RequiredIndexKeyTypes { get; init; } = Array.Empty<string>();
    public IReadOnlyList<string> OptionalIndexKeyTypes { get; init; } = Array.Empty<string>();

    /// <summary>Compiled index projections evaluated on Append.</summary>
    public IReadOnlyList<JournalIndexAccessor> IndexAccessors { get; init; }
        = Array.Empty<JournalIndexAccessor>();

    /// <summary>
    /// Projects index keys from a payload instance, enforcing required accessors.
    /// </summary>
    public IReadOnlyList<JournalIndexKey> ExtractIndexKeys(object payload)
    {
        ArgumentNullException.ThrowIfNull(payload);

        if (!ClrType.IsInstanceOfType(payload))
        {
            throw new ArgumentException(
                $"Payload type '{payload.GetType().FullName}' is not an instance of '{ClrType.FullName}'.",
                nameof(payload));
        }

        if (IndexAccessors.Count == 0)
            return Array.Empty<JournalIndexKey>();

        var keys = new List<JournalIndexKey>(IndexAccessors.Count);

        foreach (var accessor in IndexAccessors)
        {
            var value = accessor.Read(payload);
            if (string.IsNullOrEmpty(value))
            {
                if (accessor.Required)
                {
                    throw new InvalidOperationException(
                        $"Journal fact '{Type}' requires index key '{accessor.KeyType}'.");
                }

                continue;
            }

            keys.Add(new JournalIndexKey(accessor.KeyType, value));
        }

        return keys;
    }
}

/// <summary>
/// Extracts one index key from a payload instance.
/// </summary>
public sealed class JournalIndexAccessor
{
    public required string KeyType { get; init; }
    public required bool Required { get; init; }
    public required Func<object, string?> Read { get; init; }
}
