namespace Speculum.Api.Journal.Models;

public enum JournalOrderProperty
{
    Sequence,
    PublishedAt,
}

public enum JournalSortDirection
{
    Ascending,
    Descending,
}

/// <summary>
/// One sort clause. Set exactly one of <see cref="Property"/> or <see cref="IndexKeyType"/>.
/// Multiple clauses in <see cref="JournalQuery.Orders"/> define multi-key ordering.
/// </summary>
public sealed class JournalQueryOrder
{
    public JournalOrderProperty? Property { get; init; }

    /// <summary>
    /// Sort by the <see cref="JournalIndexKey.Value"/> of this key type.
    /// Entries missing the key are treated as null (sort after present values when ascending).
    /// </summary>
    public string? IndexKeyType { get; init; }

    public JournalSortDirection Direction { get; init; } = JournalSortDirection.Ascending;
}

/// <summary>
/// Envelope/index predicates. All set fields combine with AND.
/// </summary>
public sealed class JournalQueryFilter
{
    /// <summary>Exclusive lower bound: Sequence &gt; AfterSequence.</summary>
    public long? AfterSequence { get; init; }

    /// <summary>Exclusive upper bound: Sequence &lt; BeforeSequence.</summary>
    public long? BeforeSequence { get; init; }

    public Guid? Id { get; init; }
    public string? Type { get; init; }
    public int? SchemaVersion { get; init; }
    public PublishPolicy? PublishPolicy { get; init; }
    public DateTimeOffset? PublishedSince { get; init; }
    public DateTimeOffset? PublishedUntil { get; init; }

    /// <summary>
    /// Exact index matches (AND). Each key must be present with the given value.
    /// </summary>
    public IReadOnlyList<JournalIndexKey> IndexKeys { get; init; }
        = Array.Empty<JournalIndexKey>();

    /// <summary>
    /// Entry must carry these index key types (AND), regardless of value.
    /// </summary>
    public IReadOnlyList<string> IndexKeyTypes { get; init; }
        = Array.Empty<string>();
}

/// <summary>
/// Read request for <c>IJournalReader</c>. Filters are envelope/index based, not payload JSON paths.
/// </summary>
public sealed class JournalQuery
{
    public int? Limit { get; init; }
    public int Offset { get; init; }
    public JournalQueryFilter? Filter { get; init; }
    public IReadOnlyList<JournalQueryOrder> Orders { get; init; }
        = Array.Empty<JournalQueryOrder>();
}
